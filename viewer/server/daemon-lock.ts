import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

const heldGates = new Map<string, DatabaseSync>();

function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Exclusive lock so concurrent pi sessions never start two daemons. */
export async function acquireLock(file: string): Promise<boolean> {
	// Keep the gate until shutdown, even if an older daemon removes the PID file.
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
					const contents = readFileSync(file, "utf8").trim();
					const owner = /^\d+$/.test(contents) ? Number(contents) : 0;
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
	const emptyDeadline = performance.now() + 1000;
	let staleAttempts = 0;
	while (staleAttempts < 2) {
		try {
			const fd = openSync(file, "wx");
			try { writeSync(fd, String(process.pid)); }
			finally { closeSync(fd); }
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			let contents: string;
			try { contents = readFileSync(file, "utf8").trim(); }
			catch (readError) {
				if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw readError;
			}
			const owner = /^\d+$/.test(contents) ? Number(contents) : 0;
			// A new owner creates the file before it writes its PID. Give it time to finish.
			if (!owner && performance.now() < emptyDeadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				continue;
			}
			// A busy live process may miss health checks; never steal its lock.
			if (owner && alive(owner)) return false;
			rmSync(file, { force: true });
			staleAttempts++;
		}
	}
	return false;
}
