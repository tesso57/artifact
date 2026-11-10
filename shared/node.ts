import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Resolve symlinks in the existing prefix, even when the final path does not exist yet. */
export function resolvePhysicalPath(path: string): string {
	let current = resolve(path);
	const missing: string[] = [];
	for (;;) {
		try { return resolve(realpathSync(current), ...missing); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = dirname(current);
			if (parent === current) throw error;
			missing.unshift(basename(current));
			current = parent;
		}
	}
}

/** Keep the runtime's safe lexical dependency paths when their targets contain URL delimiters. */
export function runtimeNeedsPreserveSymlinks(root: string): boolean {
	return [join(root, "node_modules"), join(root, "viewer", "node_modules")].some((path) =>
		existsSync(path) && /[#?%]/.test(resolvePhysicalPath(path)),
	);
}

/**
 * Node binary for the daemon. pi may run as a Bun-compiled binary, where `process.execPath`
 * is pi itself, so only reuse it when it is Node.
 */
export function nodeBinary(): string {
	if (process.env.PI_ARTIFACTS_NODE) return process.env.PI_ARTIFACTS_NODE;
	const exe = basename(process.execPath).toLowerCase();
	return /^node\d*(\.exe)?$/.test(exe) ? process.execPath : "node";
}

/** `[major, minor]` of a Node binary (asks it, since it may differ from the current runtime). */
function nodeVersion(bin = nodeBinary()): [number, number] {
	const probe = bin === process.execPath ? undefined : spawnSync(bin, ["-p", "process.versions.node"], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
	const out = bin === process.execPath ? process.versions.node : probe?.status === 0 ? probe.stdout : undefined;
	const [major, minor] = String(out ?? "").trim().split(".").map(Number);
	return [major || 0, minor || 0];
}

/** Flags that let `bin` run the daemon's TypeScript directly; throws when it is too old. */
export function nodeTsFlags(bin = nodeBinary()): string[] {
	const [major, minor] = nodeVersion(bin);
	if (major === 0) throw new Error(`Cannot run "${bin}": install Node.js 22.19+ or set PI_ARTIFACTS_NODE`);
	if (major < 22 || (major === 22 && minor < 19)) throw new Error(`pi-artifacts needs Node.js 22.19+ for its viewer (found ${major}.${minor} at "${bin}"); set PI_ARTIFACTS_NODE`);
	// Node 23 enabled SQLite by default in 23.4, and type stripping in 23.6.
	if (major === 23 && minor < 6) return ["--experimental-strip-types", ...(minor < 4 ? ["--experimental-sqlite"] : []), "--no-warnings"];
	return ["--no-warnings=ExperimentalWarning"];
}
