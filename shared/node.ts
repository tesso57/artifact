import { spawnSync } from "node:child_process";
import { basename } from "node:path";

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
	const out = bin === process.execPath ? process.versions.node : spawnSync(bin, ["-p", "process.versions.node"], { encoding: "utf8" }).stdout;
	const [major, minor] = String(out ?? "").trim().split(".").map(Number);
	return [major || 0, minor || 0];
}

/** Flags that let `bin` run the daemon's TypeScript directly; throws when it is too old. */
export function nodeTsFlags(bin = nodeBinary()): string[] {
	const [major, minor] = nodeVersion(bin);
	if (major === 0) throw new Error(`Cannot run "${bin}": install Node.js 22.18+ or set PI_ARTIFACTS_NODE`);
	// Type stripping is on by default from Node 22.18 / 23.6; 22.6+ has it behind a flag.
	if (major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18)) return ["--no-warnings=ExperimentalWarning"];
	if (major === 22 && minor >= 6) return ["--experimental-strip-types", "--no-warnings"];
	throw new Error(`pi-artifacts needs Node.js 22.18+ for its viewer (found ${major}.${minor} at "${bin}"); set PI_ARTIFACTS_NODE`);
}
