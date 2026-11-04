import { basename } from "node:path";

/**
 * Node binary for child processes (vite, the exporter). pi may run as a Bun-compiled
 * binary, where `process.execPath` is pi itself, so only reuse it when it is Node.
 */
export function nodeBinary(): string {
	if (process.env.PI_ARTIFACTS_NODE) return process.env.PI_ARTIFACTS_NODE;
	const exe = basename(process.execPath).toLowerCase();
	return exe === "node" || exe === "node.exe" || /^node\d*(\.exe)?$/.test(exe) ? process.execPath : "node";
}

/** Flags that let Node run the viewer's TypeScript scripts directly. */
export function nodeTsFlags(): string[] {
	const [major, minor] = process.versions.node.split(".").map(Number);
	// Type stripping is on by default from Node 22.18 / 23.6.
	const builtIn = major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
	return builtIn ? ["--no-warnings=ExperimentalWarning"] : ["--experimental-strip-types", "--no-warnings"];
}
