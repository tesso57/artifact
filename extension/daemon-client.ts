/**
 * Finds or starts the per-user viewer daemon and talks to its HTTP API.
 *
 * When this package is installed inside a node_modules folder (npm installs), Node will not
 * run its TypeScript and Vite plugins skip it, so the daemon's sources are copied to
 * `~/.pi/artifacts/.runtime/<version>` first, with links back to the installed dependencies.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, closeSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { nodeBinary, nodeTsFlags, resolvePhysicalPath, runtimeNeedsPreserveSymlinks } from "../shared/node.ts";
import { daemonStatePath, PACKAGE_ROOT, runtimeDir, stateDir } from "../shared/paths.ts";
import { compareVersions, DAEMON_SECRET_HEADER, type DaemonState, PROTOCOL_VERSION } from "../shared/protocol.ts";
import { LEGACY_LOCK_EXIT_CODE, readLockOwner } from "../shared/daemon-lock.ts";

const PACKAGE_VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;

export class ViewerNotRunningError extends Error {
	constructor() { super("The artifact viewer is not running"); }
}

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

function isHealth(value: unknown): value is Health {
	if (!value || typeof value !== "object") return false;
	const health = value as { protocol?: unknown; version?: unknown };
	return Number.isInteger(health.protocol) && typeof health.version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(health.version);
}

/** A daemon this client can use: same protocol, and not older than this package. */
export function compatible(h: Health | undefined): boolean {
	return isHealth(h) && h.protocol === PROTOCOL_VERSION && compareVersions(h.version, PACKAGE_VERSION) >= 0;
}

function lockOwnerAlive(): boolean {
	try {
		const pid = readLockOwner(join(stateDir(), "viewer.lock"));
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
		if (!res.ok) return undefined;
		const data: unknown = await res.json();
		return isHealth(data) ? data : undefined;
	} catch {
		return undefined;
	}
}

/** Cancel one caller's wait without cancelling a startup shared by other sessions. */
function waitForStartup<T>(startup: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return startup;
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
		signal.addEventListener("abort", abort, { once: true });
		startup.then(
			(value) => { signal.removeEventListener("abort", abort); resolve(value); },
			(error) => { signal.removeEventListener("abort", abort); reject(error); },
		);
	});
}

/** The node_modules folder that contains this package, if it is installed in one. */
function enclosingNodeModules(root: string): string | undefined {
	const parts = root.split(sep);
	const i = parts.lastIndexOf("node_modules");
	return i >= 0 ? parts.slice(0, i + 1).join(sep) : undefined;
}

const RUNTIME_PARTS = ["viewer", "shared", "package.json", "tsconfig.base.json", join("skills", "artifacts", "templates")];

/** Vite cannot load its own runtime from a directory containing URL delimiters. */
function usableRuntimeDir(): string {
	const configured = resolve(runtimeDir());
	const physical = resolvePhysicalPath(configured);
	if (!/[#?%]/.test(configured) && !/[#?%]/.test(physical)) return configured;
	const identity = `${process.getuid?.() ?? homedir()}\0${configured}\0${physical}`;
	const name = `pi-artifacts-runtime-${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
	const windowsTemp = process.env.SystemRoot ? join(process.env.SystemRoot, "Temp") : undefined;
	const parents = [...new Set([tmpdir(), ...(process.platform === "win32" ? (windowsTemp ? [windowsTemp] : []) : ["/tmp"])])];
	for (const parent of parents) {
		try { if (/[#?%]/.test(parent) || /[#?%]/.test(resolvePhysicalPath(parent))) continue; } catch { continue; }
		const dir = join(parent, name);
		try {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			const stat = lstatSync(dir);
			if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) continue;
			if (process.platform !== "win32") chmodSync(dir, 0o700);
			return dir;
		} catch {}
	}
	throw new Error("Cannot create a safe temporary runtime directory; set PI_ARTIFACTS_RUNTIME to a path without #, ? or %");
}

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
function sourceStamp(root: string, dependencyRoot: string): string {
	const hash = createHash("sha256");
	// Runtime copies contain dependency links; equal sources at different install
	// locations must not share a copy that points at the wrong installation.
	hash.update(resolve(root));
	for (const path of [join(root, "node_modules"), dependencyRoot]) {
		if (existsSync(path)) hash.update(realpathSync(path));
	}
	for (const part of RUNTIME_PARTS) {
		const p = join(root, part);
		if (!existsSync(p)) continue;
		for (const f of statSync(p).isDirectory() ? walk(p).sort() : [p]) hash.update(f.slice(root.length)).update(readFileSync(f));
	}
	return `${PACKAGE_VERSION}-${hash.digest("hex").slice(0, 12)}`;
}

/** Directory to run the daemon from (the package itself, or a runtime copy). */
export function runtimeRoot(root = PACKAGE_ROOT): string {
	const physicalRoot = resolvePhysicalPath(root);
	const hoisted = enclosingNodeModules(physicalRoot) ?? enclosingNodeModules(root);
	if (!hoisted && !/[#?%]/.test(root) && !/[#?%]/.test(physicalRoot)) return root;
	let dependencies = hoisted;
	if (!dependencies) {
		try {
			dependencies = dirname(dirname(realpathSync(createRequire(join(root, "package.json")).resolve("vite/package.json"))));
		} catch (error) {
			throw new Error(`Cannot locate Vite dependencies for ${root}`, { cause: error });
		}
	}
	const stamp = sourceStamp(root, dependencies);
	const runtimeBase = usableRuntimeDir();
	const target = join(runtimeBase, stamp);
	if (existsSync(target)) {
		if (existsSync(join(target, ".ready"))) return target;
		throw new Error(`Could not finalize runtime at ${target}: path is already occupied`);
	}
	// Build in a private folder, then rename: concurrent sessions never see a half copy.
	mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
	const tmp = mkdtempSync(`${target}.tmp-`);
	try {
		for (const part of RUNTIME_PARTS) {
			cpSync(join(root, part), join(tmp, part), { recursive: true, filter: (src) => basename(src) !== "node_modules" });
		}
		const link = (from: string, to: string) => existsSync(to) && symlinkSync(to, from, process.platform === "win32" ? "junction" : "dir");
		// Dependencies nested under the package win over hoisted ones, as in the original layout.
		link(join(tmp, "viewer", "node_modules"), join(root, "node_modules"));
		link(join(tmp, "node_modules"), dependencies);
		cpSync(join(root, "package.json"), join(tmp, ".ready"));
		try {
			renameSync(tmp, target);
		} catch (error) {
			if (!existsSync(join(target, ".ready"))) throw new Error(`Could not finalize runtime at ${target}`, { cause: error });
			rmSync(tmp, { recursive: true, force: true }); // another session won the race
		}
	} catch (error) {
		try { rmSync(tmp, { recursive: true, force: true }); }
		catch (cleanupError) { throw new AggregateError([error, cleanupError], `Could not clean up temporary runtime ${tmp}`); }
		throw error;
	}
	// Old copies are pruned by the daemon once it holds the lock (it knows which copy it runs).
	return target;
}

export class DaemonClient {
	private state: DaemonState | undefined;
	private starting: Promise<DaemonState> | undefined;
	/** Called after this client started a new daemon (the session re-registers right away). */
	onStarted: (() => void) | undefined;

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
		// A daemon that holds the lock but is not answering yet (starting, or busy): wait for it
		// rather than racing it with a second spawn.
		for (let i = 0; i < 100 && lockOwnerAlive(); i++) {
			const state = readState();
			if (state && compatible(await healthy(state))) return (this.state = state);
			await new Promise((r) => setTimeout(r, 200));
		}
		this.state = await this.spawn();
		this.onStarted?.();
		return this.state;
	}

	private async spawn(): Promise<DaemonState> {
		mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
		const root = runtimeRoot();
		const logFile = join(stateDir(), "viewer.log");
		const log = openSync(logFile, "a", 0o600);
		const bin = nodeBinary();
		const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", FORCE_COLOR: "0" };
		if (root !== PACKAGE_ROOT) environment.PI_ARTIFACTS_RUNTIME = dirname(root);
		const child = (() => {
			try {
				return spawn(bin, [...nodeTsFlags(bin), ...(runtimeNeedsPreserveSymlinks(root) ? ["--preserve-symlinks"] : []), join(root, "viewer", "server", "daemon.ts")], {
					cwd: join(root, "viewer"),
					detached: true,
					stdio: ["ignore", log, log],
					windowsHide: true,
					env: environment,
				});
			} finally { closeSync(log); }
		})();
		let spawnError: Error | undefined;
		child.once("error", (error) => { spawnError = error; });
		child.unref();
		const deadline = performance.now() + 60_000;
		while (performance.now() < deadline) {
			const state = readState();
			if (state && compatible(await healthy(state))) return state;
			if (spawnError) throw new Error(`Could not start the artifact viewer with ${bin}: ${spawnError.message}`, { cause: spawnError });
			if (child.exitCode === LEGACY_LOCK_EXIT_CODE) break;
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
	 * daemon is started, and a failed GET can restart it once; POSTs are not retried because
	 * the server may already have applied them. Background calls pass `start: false`.
	 */
	async api<T>(path: string, body?: unknown, { start = true, timeoutMs = 300_000, beforeSendSignal }: { start?: boolean; timeoutMs?: number; beforeSendSignal?: AbortSignal } = {}): Promise<T> {
		const retry = start;
		let state: DaemonState;
		beforeSendSignal?.throwIfAborted();
		if (start) state = await waitForStartup(this.ensure(), beforeSendSignal);
		else {
			// Background calls re-read the state file: a replacement daemon has a new secret.
			const current = readState();
			if (!current) throw new ViewerNotRunningError();
			state = this.state = current;
		}
		beforeSendSignal?.throwIfAborted();
		let res: Response;
		try {
			res = await fetch(`${state.url}/__pi/api${path}`, {
				method: body === undefined ? "GET" : "POST",
				headers: { [DAEMON_SECRET_HEADER]: state.secret, "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			this.state = undefined;
			if (body !== undefined && start) {
				const reason = error instanceof Error && error.name === "TimeoutError" ? `timed out after ${timeoutMs} ms` : "lost its response";
				throw new Error(`Viewer API ${path} ${reason}; the operation may have completed. Check the result before retrying.`, { cause: error });
			}
			if (!retry) throw error;
			// The daemon went away (crash, idle exit): start a new one and retry once.
			await this.ensure();
			return this.api<T>(path, body, { start: false, timeoutMs, beforeSendSignal });
		}
		if (res.status === 401) this.state = undefined; // the daemon was replaced
		const json = (await res.json().catch((error: unknown) => {
			if (res.ok) throw new Error(`Viewer API ${path} returned an unreadable response; the operation's outcome may be unknown. Check the result before retrying.`, { cause: error });
			return {};
		})) as T & { error?: string };
		if (!res.ok) throw new Error(json.error ?? `Viewer API ${path}: HTTP ${res.status}`);
		return json;
	}

	/** A one-use login link for the browser that opens `next` while the viewer is running. */
	async link(next = "/"): Promise<string> {
		return (await this.api<{ url: string }>("/link", { next })).url;
	}
}
