import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const BUNDLED_TEMPLATES_DIR = join(PACKAGE_ROOT, "skills", "artifacts", "templates");

export function projectRoot(cwd = process.cwd()): string {
	const start = resolve(cwd);
	let piRoot: string | undefined;
	for (let dir = start; dir !== homedir() && dirname(dir) !== dir; dir = dirname(dir)) {
		if (existsSync(join(dir, ".git"))) return dir;
		if (!piRoot && statSync(join(dir, ".pi"), { throwIfNoEntry: false })?.isDirectory()) piRoot = dir;
	}
	return piRoot ?? start;
}

export function artifactsDir(cwd = process.cwd()): string {
	return process.env.PI_ARTIFACTS_DIR ? resolve(cwd, process.env.PI_ARTIFACTS_DIR) : resolve(projectRoot(cwd), ".pi", "_artifacts");
}

export function stateDir(cwd = process.cwd()): string {
	if (process.env.PI_ARTIFACTS_STATE) return resolve(cwd, process.env.PI_ARTIFACTS_STATE);
	return process.env.PI_ARTIFACTS_DIR ? join(artifactsDir(cwd), ".state") : resolve(projectRoot(cwd), ".pi", "_artifacts-state");
}

export function runtimeDir(cwd = process.cwd()): string {
	if (process.env.PI_ARTIFACTS_RUNTIME) return resolve(cwd, process.env.PI_ARTIFACTS_RUNTIME);
	return process.env.PI_ARTIFACTS_DIR ? join(artifactsDir(cwd), ".runtime") : join(stateDir(cwd), "runtime");
}

export function memoryDbPath(cwd = process.cwd()): string {
	return process.env.PI_ARTIFACTS_DB ? resolve(cwd, process.env.PI_ARTIFACTS_DB) : join(stateDir(cwd), "memory.sqlite");
}

export function daemonStatePath(cwd = process.cwd()): string {
	return join(stateDir(cwd), "viewer.json");
}

export function userTemplatesDir(): string {
	return process.env.PI_ARTIFACTS_TEMPLATES ?? join(artifactsDir(), ".templates");
}

export function designDir(): string {
	return process.env.PI_ARTIFACTS_DESIGN ?? join(artifactsDir(), ".design");
}

export function fsUrl(file: string): string {
	const posix = file.replace(/\\/g, "/");
	const encoded = encodeURI(posix).replaceAll("#", "%23").replaceAll("?", "%3F");
	return `/@fs${posix.startsWith("/") ? "" : "/"}${encoded}`;
}
