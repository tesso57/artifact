/**
 * Finds or starts the per-user viewer daemon and talks to its HTTP API.
 *
 * When this package is installed inside a node_modules folder (npm installs), Node will not
 * run its TypeScript and Vite plugins skip it, so the daemon's sources are copied to
 * `~/.pi/artifacts/.runtime/<version>` first, with links back to the installed dependencies.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, statSync, symlinkSync, cpSync, rmSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { nodeBinary, nodeTsFlags } from "../shared/node.ts";
import { daemonStatePath, PACKAGE_ROOT, runtimeDir, stateDir } from "../shared/paths.ts";
import { DAEMON_SECRET_HEADER, type DaemonState } from "../shared/protocol.ts";

const PACKAGE_VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;

function readState(): DaemonState | undefined {
	try {
		return JSON.parse(readFileSync(daemonStatePath(), "utf8")) as DaemonState;
	} catch {
		return undefined;
	}
}

async function healthy(state: DaemonState): Promise<{ version: string } | undefined> {
	try {
		const res = await fetch(`${state.url}/__pi/api/health`, {
			headers: { [DAEMON_SECRET_HEADER]: state.secret },
			signal: AbortSignal.timeout(1500),
		});
		return res.ok ? ((await res.json()) as { version: string }) : undefined;
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

/** Directory to run the daemon from (the package itself, or a runtime copy). */
export function runtimeRoot(root = PACKAGE_ROOT): string {
	const hoisted = enclosingNodeModules(root);
	if (!hoisted) return root;
	const stamp = `${PACKAGE_VERSION}-${Math.round(statSync(join(root, "package.json")).mtimeMs)}`;
	const target = join(runtimeDir(), stamp);
	if (existsSync(join(target, ".ready"))) return target;
	rmSync(target, { recursive: true, force: true });
	mkdirSync(target, { recursive: true });
	for (const part of ["viewer", "shared", "package.json", "tsconfig.base.json", join("skills", "artifacts", "templates")]) {
		cpSync(join(root, part), join(target, part), {
			recursive: true,
			filter: (src) => basename(src) !== "node_modules",
		});
	}
	const link = (from: string, to: string) => existsSync(to) && symlinkSync(to, from, process.platform === "win32" ? "junction" : "dir");
	// Dependencies nested under the package win over hoisted ones, as in the original layout.
	link(join(target, "viewer", "node_modules"), join(root, "node_modules"));
	link(join(target, "node_modules"), hoisted);
	cpSync(join(root, "package.json"), join(target, ".ready"));
	return target;
}

export class DaemonClient {
	private state: DaemonState | undefined;
	private starting: Promise<DaemonState> | undefined;

	get url(): string | undefined {
		return this.state?.url;
	}

	/** Whether a daemon of this version is already running (never starts one). */
	async running(): Promise<boolean> {
		const state = readState();
		if (!state || (await healthy(state))?.version !== PACKAGE_VERSION) return false;
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
			if (health?.version === PACKAGE_VERSION) return (this.state = existing);
			if (health) {
				// An older (or newer) viewer: replace it so code and API match this extension.
				await fetch(`${existing.url}/__pi/api/shutdown`, { method: "POST", headers: { [DAEMON_SECRET_HEADER]: existing.secret } }).catch(() => {});
				for (let i = 0; i < 40 && (await healthy(existing)); i++) await new Promise((r) => setTimeout(r, 100));
			}
		}
		return (this.state = await this.spawn());
	}

	private async spawn(): Promise<DaemonState> {
		mkdirSync(stateDir(), { recursive: true });
		const root = runtimeRoot();
		const logFile = join(stateDir(), "viewer.log");
		const log = openSync(logFile, "a");
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
			if (state && (await healthy(state))?.version === PACKAGE_VERSION) return state;
			if (child.exitCode !== null && !readState()) break;
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

	/** Call the daemon API; restarts the daemon once if it went away. */
	async api<T>(path: string, body?: unknown, retry = true): Promise<T> {
		const state = await this.ensure();
		let res: Response;
		try {
			res = await fetch(`${state.url}/__pi/api${path}`, {
				method: body === undefined ? "GET" : "POST",
				headers: { [DAEMON_SECRET_HEADER]: state.secret, "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(300_000),
			});
		} catch (error) {
			if (!retry) throw error;
			this.state = undefined;
			return this.api(path, body, false);
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
