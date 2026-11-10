/**
 * The viewer daemon: one per user. Serves every artifact from a single Vite dev server
 * (TanStack Start), owns the SQLite memory, and routes MCP calls to registered pi
 * sessions. Started by the pi extension (detached) or with `npm run dev`.
 *
 *   node viewer/server/daemon.ts [--foreground]
 *
 * State: <state>/viewer.json { pid, port, url, secret, version }; <state>/viewer.lock.
 * Exits after PI_ARTIFACTS_IDLE_MS (default 15 min) without sessions, requests or unused links.
 */
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createServer } from "vite";
import { artifactsDir, BUNDLED_TEMPLATES_DIR, daemonStatePath, PACKAGE_ROOT, runtimeDir, stateDir, userTemplatesDir } from "../../shared/paths.ts";
import { type DaemonState, PROTOCOL_VERSION } from "../../shared/protocol.ts";
import { DaemonContext } from "./context.ts";
import { VIEWER_DIR } from "./vite-shared.ts";
import { RuntimeAliases } from "./runtime-aliases.ts";
import { acquireLock } from "./daemon-lock.ts";

const foreground = process.argv.includes("--foreground");
const idleMs = Number(process.env.PI_ARTIFACTS_IDLE_MS) || 15 * 60_000;
const version = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;

// State (SQLite with memory and MCP results, logs, the secret) is private to the user.
mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
try {
	chmodSync(stateDir(), 0o700);
} catch {}
const lockFile = join(stateDir(), "viewer.lock");
if (!(await acquireLock(lockFile))) {
	console.log("pi-artifacts viewer lock is held by another live process");
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

// Tailwind's scanner must see the roots before its first scan to discover new files later.
mkdirSync(artifactsDir(), { recursive: true });
mkdirSync(userTemplatesDir(), { recursive: true });
const aliases = new RuntimeAliases([artifactsDir(), userTemplatesDir(), BUNDLED_TEMPLATES_DIR]);
process.once("exit", () => aliases.cleanup());
const ctx = new DaemonContext(version, undefined, aliases);
DaemonContext.install(ctx);

const server = await createServer({
	configFile: join(VIEWER_DIR, "vite.config.ts"),
	// The runtime is copied outside node_modules for Node's TypeScript loader. Native
	// config loading also avoids Vite's bundler misreading delimiters in dependency paths.
	configLoader: "native",
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
		if (ctx.isIdle(idleMs)) void stop("idle");
	}, Math.min(30_000, idleMs)).unref();
}
