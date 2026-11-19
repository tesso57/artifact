import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, closeSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { nodeBinary, nodeTsFlags, resolvePhysicalPath, runtimeNeedsPreserveSymlinks } from "../shared/node.ts";
import { artifactsDir, daemonStatePath, PACKAGE_ROOT, projectRoot, runtimeDir, stateDir } from "../shared/paths.ts";
import { compareVersions, DAEMON_SECRET_HEADER, type DaemonState, PROTOCOL_VERSION } from "../shared/protocol.ts";
import { LEGACY_LOCK_EXIT_CODE, readLockOwner } from "../shared/daemon-lock.ts";

const PACKAGE_VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;

export class ViewerNotRunningError extends Error {
	constructor() { super("The artifact viewer is not running"); }
}

function readState(cwd: string): DaemonState | undefined {
	try {
		return JSON.parse(readFileSync(daemonStatePath(cwd), "utf8")) as DaemonState;
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

export function compatible(h: Health | undefined): boolean {
	return isHealth(h) && h.protocol === PROTOCOL_VERSION && compareVersions(h.version, PACKAGE_VERSION) >= 0;
}

function lockOwnerAlive(cwd: string): boolean {
	try {
		const pid = readLockOwner(join(stateDir(cwd), "viewer.lock"));
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

function enclosingNodeModules(root: string): string | undefined {
	const parts = root.split(sep);
	const i = parts.lastIndexOf("node_modules");
	return i >= 0 ? parts.slice(0, i + 1).join(sep) : undefined;
}

const RUNTIME_PARTS = ["viewer", "shared", "package.json", "tsconfig.base.json", join("skills", "artifacts", "templates")];

function usableRuntimeDir(cwd: string): string {
	const configured = resolve(runtimeDir(cwd));
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

function sourceStamp(root: string, dependencyRoot: string): string {
	const hash = createHash("sha256");
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

export function runtimeRoot(root = PACKAGE_ROOT, cwd = process.cwd()): string {
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
	const runtimeBase = usableRuntimeDir(cwd);
	const target = join(runtimeBase, stamp);
	if (existsSync(target)) {
		if (existsSync(join(target, ".ready"))) return target;
		throw new Error(`Could not finalize runtime at ${target}: path is already occupied`);
	}
	mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
	const tmp = mkdtempSync(`${target}.tmp-`);
	try {
		for (const part of RUNTIME_PARTS) {
			cpSync(join(root, part), join(tmp, part), { recursive: true, filter: (src) => basename(src) !== "node_modules" });
		}
		const link = (from: string, to: string) => existsSync(to) && symlinkSync(to, from, process.platform === "win32" ? "junction" : "dir");
		link(join(tmp, "viewer", "node_modules"), join(root, "node_modules"));
		link(join(tmp, "node_modules"), dependencies);
		cpSync(join(root, "package.json"), join(tmp, ".ready"));
		try {
			renameSync(tmp, target);
		} catch (error) {
			if (!existsSync(join(target, ".ready"))) throw new Error(`Could not finalize runtime at ${target}`, { cause: error });
			rmSync(tmp, { recursive: true, force: true });
		}
	} catch (error) {
		try { rmSync(tmp, { recursive: true, force: true }); }
		catch (cleanupError) { throw new AggregateError([error, cleanupError], `Could not clean up temporary runtime ${tmp}`); }
		throw error;
	}
	return target;
}

export class DaemonClient {
	private cwd = process.cwd();
	setProject(cwd: string): void {
		const next = resolve(cwd);
		if ((this.starting || this.state) && next !== this.cwd) throw new Error("Cannot change artifact project while a viewer is connected");
		this.cwd = next;
	}
	get artifactsRoot(): string { return artifactsDir(this.cwd); }
	private state: DaemonState | undefined;
	private starting: Promise<DaemonState> | undefined;
	onStarted: (() => void) | undefined;

	get url(): string | undefined {
		return this.state?.url;
	}

	async running(): Promise<boolean> {
		const state = readState(this.cwd);
		if (!state || !compatible(await healthy(state))) return false;
		this.state = state;
		return true;
	}

	ensure(): Promise<DaemonState> {
		this.starting ??= this.connect().finally(() => {
			this.starting = undefined;
		});
		return this.starting;
	}

	private async connect(): Promise<DaemonState> {
		const existing = readState(this.cwd);
		if (existing) {
			const health = await healthy(existing);
			if (compatible(health)) return (this.state = existing);
			if (health && health.protocol !== PROTOCOL_VERSION && compareVersions(health.version, PACKAGE_VERSION) > 0) {
				throw new Error(`A newer, incompatible artifact viewer (${health.version}) is running; update pi-artifacts`);
			}
			if (health) {
				await fetch(`${existing.url}/__pi/api/shutdown`, { method: "POST", headers: { [DAEMON_SECRET_HEADER]: existing.secret } }).catch(() => {});
				for (let i = 0; i < 40 && (await healthy(existing)); i++) await new Promise((r) => setTimeout(r, 100));
			}
		}
		for (let i = 0; i < 100 && lockOwnerAlive(this.cwd); i++) {
			const state = readState(this.cwd);
			if (state && compatible(await healthy(state))) return (this.state = state);
			await new Promise((r) => setTimeout(r, 200));
		}
		this.state = await this.spawn();
		this.onStarted?.();
		return this.state;
	}

	private async spawn(): Promise<DaemonState> {
		mkdirSync(stateDir(this.cwd), { recursive: true, mode: 0o700 });
		if (stateDir(this.cwd) === join(projectRoot(this.cwd), ".pi", "_artifacts-state")) {
			try { writeFileSync(join(stateDir(this.cwd), ".gitignore"), "*\n", { flag: "wx", mode: 0o600 }); }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
		}
		const root = runtimeRoot(PACKAGE_ROOT, this.cwd);
		const logFile = join(stateDir(this.cwd), "viewer.log");
		const log = openSync(logFile, "a", 0o600);
		const bin = nodeBinary();
		const environment: NodeJS.ProcessEnv = { ...process.env, PI_ARTIFACTS_DIR: this.artifactsRoot, PI_ARTIFACTS_STATE: stateDir(this.cwd), PI_ARTIFACTS_RUNTIME: runtimeDir(this.cwd), NODE_ENV: "development", FORCE_COLOR: "0" };
		for (const key of ["PI_ARTIFACTS_STATE", "PI_ARTIFACTS_RUNTIME", "PI_ARTIFACTS_DB", "PI_ARTIFACTS_TEMPLATES", "PI_ARTIFACTS_DESIGN"] as const) {
			if (environment[key]) environment[key] = resolve(this.cwd, environment[key]);
		}
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
			const state = readState(this.cwd);
			if (state && compatible(await healthy(state))) return state;
			if (spawnError) throw new Error(`Could not start the artifact viewer with ${bin}: ${spawnError.message}`, { cause: spawnError });
			if (child.exitCode === LEGACY_LOCK_EXIT_CODE) break;
			if (child.exitCode !== null && !lockOwnerAlive(this.cwd) && !readState(this.cwd)) break;
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

	async api<T>(path: string, body?: unknown, { start = true, timeoutMs = 300_000, beforeSendSignal }: { start?: boolean; timeoutMs?: number; beforeSendSignal?: AbortSignal } = {}): Promise<T> {
		const retry = start;
		let state: DaemonState;
		beforeSendSignal?.throwIfAborted();
		if (start) state = await waitForStartup(this.ensure(), beforeSendSignal);
		else {
			const current = readState(this.cwd);
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
			await this.ensure();
			return this.api<T>(path, body, { start: false, timeoutMs, beforeSendSignal });
		}
		if (res.status === 401) this.state = undefined;
		const json = (await res.json().catch((error: unknown) => {
			if (res.ok) throw new Error(`Viewer API ${path} returned an unreadable response; the operation's outcome may be unknown. Check the result before retrying.`, { cause: error });
			return {};
		})) as T & { error?: string };
		if (!res.ok) throw new Error(json.error ?? `Viewer API ${path}: HTTP ${res.status}`);
		return json;
	}

	async link(next = "/"): Promise<string> {
		return (await this.api<{ url: string }>("/link", { next })).url;
	}
}
