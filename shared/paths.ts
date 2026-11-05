import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Root of this package (extension/, viewer/, shared/, skills/). */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Templates shipped with the artifacts skill. */
export const BUNDLED_TEMPLATES_DIR = join(PACKAGE_ROOT, "skills", "artifacts", "templates");

/** `~/.pi/artifacts`: one folder per artifact (`<id>/index.tsx` + `meta.json`). */
export function artifactsDir(): string {
	return process.env.PI_ARTIFACTS_DIR ?? resolve(homedir(), ".pi", "artifacts");
}

/** Daemon state (lock file, logs, SQLite) — never served or scanned. */
export function stateDir(): string {
	return process.env.PI_ARTIFACTS_STATE ?? join(artifactsDir(), ".state");
}

/** Copies of the daemon's sources when the package is installed inside node_modules. */
export function runtimeDir(): string {
	return process.env.PI_ARTIFACTS_RUNTIME ?? join(artifactsDir(), ".runtime");
}

export function memoryDbPath(): string {
	return process.env.PI_ARTIFACTS_DB ?? join(stateDir(), "memory.sqlite");
}

export function daemonStatePath(): string {
	return join(stateDir(), "viewer.json");
}

/** User templates: `<dir>/<name>/{template.tsx,template.json}`. */
export function userTemplatesDir(): string {
	return process.env.PI_ARTIFACTS_TEMPLATES ?? join(artifactsDir(), ".templates");
}

/** User design system: `theme.css` (token overrides) and `DESIGN.md` (decisions). */
export function designDir(): string {
	return process.env.PI_ARTIFACTS_DESIGN ?? join(artifactsDir(), ".design");
}

/** POSIX-style `/@fs/…` URL Vite serves a file outside the project root from (works on Windows). */
export function fsUrl(file: string): string {
	const posix = file.replace(/\\/g, "/");
	return `/@fs${posix.startsWith("/") ? "" : "/"}${posix}`;
}
