import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Root of the TanStack Start viewer app. */
export const VIEWER_DIR = resolve(here, "../../../apps/viewer");

/** Where artifact folders (`<id>/index.tsx` + `meta.json`) are stored. */
export function artifactsDir(): string {
	return process.env.PI_ARTIFACTS_DIR ?? resolve(homedir(), ".pi", "artifacts");
}

/** SQLite file that backs artifact memory. */
export function memoryDbPath(): string {
	return process.env.PI_ARTIFACTS_DB ?? resolve(artifactsDir(), ".memory.sqlite");
}
