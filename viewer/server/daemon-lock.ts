import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Exclusive lock so concurrent pi sessions never start two daemons. */
export async function acquireLock(file: string): Promise<boolean> {
	// Serialize PID-lock recovery across new daemons. SQLite releases its lock if a
	// process dies, so recovery itself cannot leave a second stale lock behind.
	const gate = new DatabaseSync(`${file}.gate.sqlite`);
	try {
		const deadline = performance.now() + 5000;
		for (;;) {
			try { gate.exec("BEGIN IMMEDIATE"); break; }
			catch (error) {
				if (((error as { errcode?: number }).errcode ?? 0) % 256 !== 5) throw error;
				if (performance.now() >= deadline) return false;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
		return await acquirePidLock(file);
	} finally {
		gate.close();
	}
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
