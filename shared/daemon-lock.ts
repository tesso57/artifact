import { lstatSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LEGACY_LOCK_EXIT_CODE = 75;
const MARKER = "pi-artifacts-directory-lock-v2\n";

/** Read a PID from either the current directory lock or a legacy PID file. */
export function readLockOwner(file: string): number | undefined {
	try {
		const info = lstatSync(file);
		if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) return undefined;
		const text = readFileSync(info.isDirectory() ? join(file, "pid") : file, "utf8").trim();
		const pid = /^\d+$/.test(text) ? Number(text) : 0;
		return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
	} catch (error) {
		if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
		throw error;
	}
}

export function isInitializedLock(file: string): boolean {
	try {
		const info = lstatSync(file);
		if (!info.isDirectory() || info.isSymbolicLink()) return false;
		const marker = join(file, "format");
		return lstatSync(marker).isFile() && readFileSync(marker, "utf8") === MARKER;
	} catch (error) {
		if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
		throw error;
	}
}

/** Initialize only when no older pi session or viewer can be recovering a legacy lock. */
export function initializeDirectoryLock(file: string): void {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	try { mkdirSync(file, { mode: 0o700 }); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST" && isInitializedLock(file)) return;
		throw new Error(`Cannot initialize ${file}; stop all old pi sessions and viewers, inspect the old lock and remove it manually before retrying`, { cause: error });
	}
	try { writeFileSync(join(file, "format"), MARKER, { flag: "wx", mode: 0o600 }); }
	catch (error) { try { rmdirSync(file); } catch {} throw error; }
}
