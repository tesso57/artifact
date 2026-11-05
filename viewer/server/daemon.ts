/**
 * The viewer daemon: one per user. Serves every artifact from a single Vite dev server
 * (TanStack Start), owns the SQLite memory, and routes MCP calls to registered pi
 * sessions. Started by the pi extension (detached) or with `npm run dev`.
 *
 *   node viewer/server/daemon.ts [--foreground]
 *
 * State: <state>/viewer.json { pid, port, url, secret, version }; <state>/viewer.lock.
 * Exits after PI_ARTIFACTS_IDLE_MS (default 15 min) without sessions or requests.
 */
import { chmodSync, closeSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createServer } from "vite";
import { daemonStatePath, PACKAGE_ROOT, runtimeDir, stateDir } from "../../shared/paths.ts";
import { DAEMON_SECRET_HEADER, type DaemonState, PROTOCOL_VERSION } from "../../shared/protocol.ts";
import { DaemonContext } from "./context.ts";
import { VIEWER_DIR } from "./vite-shared.ts";

const foreground = process.argv.includes("--foreground");
const idleMs = Number(process.env.PI_ARTIFACTS_IDLE_MS) || 15 * 60_000;
const version = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Whether `pid` is the live, answering viewer daemon (not a stranger that reused the PID). */
async function ownerIsViewer(pid: number): Promise<boolean> {
	try {
		const state = JSON.parse(readFileSync(daemonStatePath(), "utf8")) as DaemonState;
		if (state.pid !== pid) return false;
		const res = await fetch(`${state.url}/__pi/api/health`, { headers: { [DAEMON_SECRET_HEADER]: state.secret }, signal: AbortSignal.timeout(2000) });
		return res.ok;
	} catch {
		return false;
	}
}

/** Exclusive lock so concurrent pi sessions never start two daemons. */
async function acquireLock(file: string): Promise<boolean> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const fd = openSync(file, "wx");
			writeSync(fd, String(process.pid));
			closeSync(fd);
			return true;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			const owner = Number(readFileSync(file, "utf8"));
			if (owner && alive(owner)) {
				// A live owner may still be starting: give it time before calling the lock stale
				// (after a crash or reboot the PID can belong to an unrelated process).
				const lockAge = Date.now() - statSync(file).mtimeMs;
				if (lockAge < 60_000 || (await ownerIsViewer(owner))) return false;
			}
			rmSync(file, { force: true }); // stale lock
		}
	}
	return false;
}

// State (SQLite with memory and MCP results, logs, the secret) is private to the user.
mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
try {
	chmodSync(stateDir(), 0o700);
} catch {}
const lockFile = join(stateDir(), "viewer.lock");
if (!(await acquireLock(lockFile))) {
	console.log("pi-artifacts viewer is already running");
	process.exit(0);
}

// Runtime copies (npm installs): delete old ones nobody can be using. This daemon holds the
// lock, so no other daemon runs; copies younger than an hour may be about to be started.
try {
	const runtimes = runtimeDir();
	const mine = resolve(PACKAGE_ROOT);
	if (dirname(mine) === resolve(runtimes)) {
		for (const name of readdirSync(runtimes)) {
			const dir = join(runtimes, name);
			if (dir !== mine && Date.now() - statSync(dir).mtimeMs > 3600_000) rmSync(dir, { recursive: true, force: true });
		}
	}
} catch {}

const ctx = new DaemonContext(version);
DaemonContext.install(ctx);

const server = await createServer({
	configFile: join(VIEWER_DIR, "vite.config.ts"),
	root: VIEWER_DIR,
	server: { port: Number(process.env.PI_ARTIFACTS_PORT) || 5178, strictPort: false },
	clearScreen: false,
	logLevel: foreground ? "info" : "warn",
});
await server.listen();
ctx.port = (server.httpServer?.address() as AddressInfo).port;

const state: DaemonState = { protocol: PROTOCOL_VERSION, pid: process.pid, port: ctx.port, url: ctx.origin, secret: ctx.secret, version, startedAt: Date.now() };
const statePath = daemonStatePath();
writeFileSync(`${statePath}.tmp`, JSON.stringify(state), { mode: 0o600 });
renameSync(`${statePath}.tmp`, statePath);
console.log(`pi-artifacts viewer ${version} on ${ctx.origin} (pid ${process.pid})`);
if (foreground) console.log(`Open: ${ctx.link("/")}`);

let stopping = false;
async function stop(reason: string) {
	if (stopping) return;
	stopping = true;
	console.log(`stopping: ${reason}`);
	try {
		const current = JSON.parse(readFileSync(statePath, "utf8")) as DaemonState;
		if (current.pid === process.pid) rmSync(statePath, { force: true });
	} catch {}
	rmSync(lockFile, { force: true });
	await server.close().catch(() => {});
	ctx.memory.close();
	process.exit(0);
}
ctx.onShutdown = () => void stop("api");
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

if (!foreground) {
	setInterval(() => {
		if (ctx.sessions.size === 0 && Date.now() - ctx.lastActivity > idleMs) void stop("idle");
	}, Math.min(30_000, idleMs)).unref();
}
