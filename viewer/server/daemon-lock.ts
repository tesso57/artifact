import { lstatSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeDirectoryLock, isInitializedLock, readLockOwner } from "../../shared/daemon-lock.ts";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

export class StaleLegacyLockError extends Error {}

const heldGates = new Map<string, DatabaseSync>();

function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Exclusive lock so concurrent pi sessions never start two daemons. */
export async function acquireLock(file: string): Promise<boolean> {
	// Keep the gate until shutdown, even if the PID file inside the directory is removed.
	// SQLite releases the lock automatically if this process dies.
	const gate = new DatabaseSync(`${file}.gate.sqlite`);
	let held = false;
	try {
		const deadline = performance.now() + 5000;
		for (;;) {
			try { gate.exec("BEGIN IMMEDIATE"); break; }
			catch (error) {
				if (((error as { errcode?: number }).errcode ?? 0) % 256 !== 5) throw error;
				try {
					const owner = readLockOwner(file);
					if (owner && alive(owner)) return false;
				} catch (readError) {
					if ((readError as NodeJS.ErrnoException).code !== "ENOENT") throw readError;
				}
				if (performance.now() >= deadline) return false;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
		if (!(await acquirePidLock(file))) return false;
		heldGates.set(file, gate);
		held = true;
		return true;
	} finally {
		if (!held) gate.close();
	}
}

/** Release the gate after the daemon has stopped and removed its PID lock. */
export function releaseLock(file: string): void {
	const gate = heldGates.get(file);
	if (!gate) return;
	heldGates.delete(file);
	gate.close();
}

async function acquirePidLock(file: string): Promise<boolean> {
	const legacyDeadline = performance.now() + 1000;
	for (;;) {
		let info;
		try { info = lstatSync(file); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				try { initializeDirectoryLock(file); } catch (initializationError) {
					throw new StaleLegacyLockError(`Cannot initialize ${file}; stop all old pi sessions and viewers, inspect any old lock and remove it manually before restarting`, { cause: initializationError });
				}
				continue;
			}
			throw error;
		}
		const owner = readLockOwner(file);
		if (owner && alive(owner)) return false;
		if (!info.isDirectory() || info.isSymbolicLink()) {
			if (!owner && performance.now() < legacyDeadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				continue;
			}
			throw new StaleLegacyLockError(`Stale legacy lock at ${file}; stop all old pi sessions and viewers, verify the lock is stale and remove it manually before restarting`);
		}
		if (!isInitializedLock(file)) throw new StaleLegacyLockError(`Unrecognized lock directory at ${file}; stop all old pi sessions and viewers and inspect it before manual recovery`);
		// Keep the initialized directory across crashes and shutdowns: legacy rm cannot delete it.
		const entries = readdirSync(file);
		if (entries.some((entry) => entry !== "pid" && entry !== "format")) throw new Error(`Unexpected files in lock directory ${file}`);
		if (entries.includes("pid")) {
			if (!lstatSync(join(file, "pid")).isFile()) throw new Error(`Invalid PID file in lock directory ${file}`);
			unlinkSync(join(file, "pid"));
		}
		writeFileSync(join(file, "pid"), String(process.pid), { flag: "wx", mode: 0o600 });
		return true;
	}
}

/** Remove only our PID, keeping the initialized directory as a legacy barrier. */
export function removePidLock(file: string): void {
	try {
		if (!isInitializedLock(file) || readLockOwner(file) !== process.pid) return;
		unlinkSync(join(file, "pid"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}
