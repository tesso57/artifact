import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { performance } from "node:perf_hooks";

function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Exclusive lock so concurrent pi sessions never start two daemons. */
export async function acquireLock(file: string): Promise<boolean> {
	const emptyDeadline = performance.now() + 1000;
	let staleAttempts = 0;
	while (staleAttempts < 2) {
		try {
			const fd = openSync(file, "wx");
			writeSync(fd, String(process.pid));
			closeSync(fd);
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
