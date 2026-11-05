/**
 * Finds or starts the per-user viewer daemon and talks to its HTTP API.
 *
 * When this package is installed inside a node_modules folder (npm installs), Node will not
 * run its TypeScript and Vite plugins skip it, so the daemon's sources are copied to
 * `~/.pi/artifacts/.runtime/<version>` first, with links back to the installed dependencies.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { nodeBinary, nodeTsFlags } from "../shared/node.ts";
import { daemonStatePath, PACKAGE_ROOT, runtimeDir, stateDir } from "../shared/paths.ts";
import { compareVersions, DAEMON_SECRET_HEADER, type DaemonState, PROTOCOL_VERSION } from "../shared/protocol.ts";

const PACKAGE_VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;

function readState(): DaemonState | undefined {
	try {
		return JSON.parse(readFileSync(daemonStatePath(), "utf8")) as DaemonState;
	} catch {
		return undefined;
	}
}

interface Health {
	protocol?: number;
	version: string;
}

/** A daemon this client can use: same protocol, and not older than this package. */
function compatible(h: Health | undefined): boolean {
	return !!h && h.protocol === PROTOCOL_VERSION && compareVersions(h.version, PACKAGE_VERSION) >= 0;
}

function lockOwnerAlive(): boolean {
	try {
		const pid = Number(readFileSync(join(stateDir(), "viewer.lock"), "utf8"));
		if (!pid) return false;
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function healthy(state: DaemonState): Promise<Health | undefined> {
	try {
		const res = await fetch(`${state.url}/__pi/api/health`, {
			headers: { [DAEMON_SECRET_HEADER]: state.secret },
			signal: AbortSignal.timeout(1500),
		});
		return res.ok ? ((await res.json()) as Health) : undefined;
	} catch {
		return undefined;
	}
}

/** The node_modules folder that contains this package, if it is installed in one. */
function enclosingNodeModules(root: string): string | undefined {
	const parts = root.split(sep);
	const i = parts.lastIndexOf("node_modules");
	return i >= 0 ? parts.slice(0, i + 1).join(sep) : undefined;
}

const RUNTIME_PARTS = ["viewer", "shared", "package.json", "tsconfig.base.json", join("skills", "artifacts", "templates")];

function walk(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules") continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

/** Hash of the daemon sources, so a reinstall with changed files gets a fresh copy. */
function sourceStamp(root: string): string {
	const hash = createHash("sha256");
	for (const part of RUNTIME_PARTS) {
		const p = join(root, part);
		if (!existsSync(p)) continue;
		for (const f of statSync(p).isDirectory() ? walk(p).sort() : [p]) hash.update(f.slice(root.length)).update(readFileSync(f));
	}
	return `${PACKAGE_VERSION}-${hash.digest("hex").slice(0, 12)}`;
}

/** Directory to run the daemon from (the package itself, or a runtime copy). */
export function runtimeRoot(root = PACKAGE_ROOT): string {
	const hoisted = enclosingNodeModules(root);
	if (!hoisted) return root;
	const stamp = sourceStamp(root);
	const target = join(runtimeDir(), stamp);
	if (existsSync(join(target, ".ready"))) return target;
	// Build in a private folder, then rename: concurrent sessions never see a half copy.
	const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
	mkdirSync(tmp, { recursive: true });
	for (const part of RUNTIME_PARTS) {
		cpSync(join(root, part), join(tmp, part), { recursive: true, filter: (src) => basename(src) !== "node_modules" });
	}
	const link = (from: string, to: string) => existsSync(to) && symlinkSync(to, from, process.platform === "win32" ? "junction" : "dir");
	// Dependencies nested under the package win over hoisted ones, as in the original layout.
	link(join(tmp, "viewer", "node_modules"), join(root, "node_modules"));
	link(join(tmp, "node_modules"), hoisted);
	cpSync(join(root, "package.json"), join(tmp, ".ready"));
	try {
		renameSync(tmp, target);
	} catch {
		rmSync(tmp, { recursive: true, force: true }); // another session won the race
	}
	// Old copies (other stamps) are no longer needed.
	for (const old of readdirSync(runtimeDir())) {
		if (old !== stamp && !old.includes(".tmp-")) rmSync(join(runtimeDir(), old), { recursive: true, force: true });
	}
	return target;
}

export class DaemonClient {
	private state: DaemonState | undefined;
	private starting: Promise<DaemonState> | undefined;

	get url(): string | undefined {
		return this.state?.url;
	}

	/** Whether a usable daemon is already running (never starts one). */
	async running(): Promise<boolean> {
		const state = readState();
		if (!state || !compatible(await healthy(state))) return false;
		this.state = state;
		return true;
	}

	/** A running daemon of this version (started if needed). */
	ensure(): Promise<DaemonState> {
		this.starting ??= this.connect().finally(() => {
			this.starting = undefined;
		});
		return this.starting;
	}

	private async connect(): Promise<DaemonState> {
		const existing = readState();
		if (existing) {
			const health = await healthy(existing);
			if (compatible(health)) return (this.state = existing);
			if (health && health.protocol !== PROTOCOL_VERSION && compareVersions(health.version, PACKAGE_VERSION) > 0) {
				throw new Error(`A newer, incompatible artifact viewer (${health.version}) is running; update pi-artifacts`);
			}
			if (health) {
				// An older viewer: replace it so code and API match this extension.
				await fetch(`${existing.url}/__pi/api/shutdown`, { method: "POST", headers: { [DAEMON_SECRET_HEADER]: existing.secret } }).catch(() => {});
				for (let i = 0; i < 40 && (await healthy(existing)); i++) await new Promise((r) => setTimeout(r, 100));
			}
		}
		return (this.state = await this.spawn());
	}

	private async spawn(): Promise<DaemonState> {
		mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
		const root = runtimeRoot();
		const logFile = join(stateDir(), "viewer.log");
		const log = openSync(logFile, "a", 0o600);
		const bin = nodeBinary();
		const child = spawn(bin, [...nodeTsFlags(bin), join(root, "viewer", "server", "daemon.ts")], {
			cwd: join(root, "viewer"),
			detached: true,
			stdio: ["ignore", log, log],
			windowsHide: true,
			env: { ...process.env, NODE_ENV: "development", FORCE_COLOR: "0" },
		});
		child.unref();
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			const state = readState();
			if (state && compatible(await healthy(state))) return state;
			// Our daemon may have exited because another session's daemon holds the lock and is
			// still starting: keep waiting while that owner lives.
			if (child.exitCode !== null && !lockOwnerAlive() && !readState()) break;
			await new Promise((r) => setTimeout(r, 200));
		}
		const tail = (() => {
			try {
				return readFileSync(logFile, "utf8").split("\n").slice(-30).join("\n");
			} catch {
				return "";
			}
		})();
		throw new Error(`The artifact viewer did not start (log: ${logFile})\n${tail}`);
	}

	/**
	 * Call the daemon API. With `start` (the default, for user and agent actions) a missing
	 * daemon is started, and a vanished one restarted once; background calls (heartbeats)
	 * pass `start: false`, so a stopped viewer stays stopped.
	 */
	async api<T>(path: string, body?: unknown, { start = true }: { start?: boolean } = {}): Promise<T> {
		const retry = start;
		let state: DaemonState;
		if (start) state = await this.ensure();
		else {
			const current = this.state ?? readState();
			if (!current) throw new Error("The artifact viewer is not running");
			state = current;
		}
		let res: Response;
		try {
			res = await fetch(`${state.url}/__pi/api${path}`, {
				method: body === undefined ? "GET" : "POST",
				headers: { [DAEMON_SECRET_HEADER]: state.secret, "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(300_000),
			});
		} catch (error) {
			this.state = undefined;
			if (!retry) throw error;
			// The daemon went away (crash, idle exit): start a new one and retry once.
			await this.ensure();
			return this.api<T>(path, body, { start: false });
		}
		const json = (await res.json().catch(() => ({}))) as T & { error?: string };
		if (!res.ok) throw new Error(json.error ?? `Viewer API ${path}: HTTP ${res.status}`);
		return json;
	}

	/** A login link for the browser that opens `next` (expires after 30 minutes). */
	async link(next = "/"): Promise<string> {
		return (await this.api<{ url: string }>("/link", { next })).url;
	}
}
