import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { acquireLock, releaseLock, removePidLock } from "../../../viewer/server/daemon-lock.ts";
import { nodeTsFlags } from "../../../shared/node.ts";
import { initializeDirectoryLock } from "../../../shared/daemon-lock.ts";

it("initializes automatically and retains the legacy barrier after shutdown", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-init-"));
	const file = join(dir, "viewer.lock");
	try {
		expect(await acquireLock(file)).toBe(true);
		removePidLock(file);
		releaseLock(file);
		await expect(rm(file, { force: true })).rejects.toThrow();
		expect(await acquireLock(file)).toBe(true);
	} finally {
		removePidLock(file);
		releaseLock(file);
		await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
});

it("prevents a delayed legacy file removal from deleting the current lock", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-legacy-unlink-"));
	const file = join(dir, "viewer.lock");
	try {
		expect(await acquireLock(file)).toBe(true);
		const script = `import { rmSync } from "node:fs"; try { rmSync(${JSON.stringify(file)}, { force: true }); console.log("removed"); } catch (error) { console.log(error.code); }`;
		const legacy = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
		expect(legacy.status).toBe(0);
		expect(legacy.stdout.trim()).toBe("ERR_FS_EISDIR");
		expect(await readFile(join(file, "pid"), "utf8")).toBe(String(process.pid));
	} finally {
		removePidLock(file);
		releaseLock(file);
		await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
});

it("preserves a stale legacy lock while legacy processes may still be recovering it", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-legacy-recovery-race-"));
	const file = join(dir, "viewer.lock");
	const legacy: ChildProcessWithoutNullStreams[] = [];
	try {
		const previous = spawnSync(process.execPath, ["-e", ""]);
		expect(previous.status).toBe(0);
		await writeFile(file, String(previous.pid));
		// The released 0.3 daemon reads the PID before removing a stale file.
		// Pause two legacy processes at that point while the new daemon attempts recovery.
		const script = `import { openSync, readFileSync } from "node:fs"; try { openSync(${JSON.stringify(file)}, "wx"); throw new Error("unexpected create"); } catch (error) { if (error.code !== "EEXIST") throw error; } const pid = Number(readFileSync(${JSON.stringify(file)}, "utf8")); try { process.kill(pid, 0); throw new Error("PID still alive"); } catch (error) { if (error.message === "PID still alive") throw error; } console.log("stale-read"); setInterval(() => {}, 1000);`;
		for (let i = 0; i < 2; i++) legacy.push(spawn(process.execPath, ["--input-type=module", "-e", script]));
		const announcements = await Promise.all(legacy.map((child) => once(child.stdout, "data")));
		for (const [data] of announcements) expect(String(data)).toContain("stale-read");
		await expect(acquireLock(file)).rejects.toThrow(/Stale legacy lock/);
		expect(await readFile(file, "utf8")).toBe(String(previous.pid));
		for (const child of legacy) {
			const exited = once(child, "exit");
			child.kill();
			await exited;
		}
		await rm(file); // Manual recovery after all old processes have stopped.
		expect(await acquireLock(file)).toBe(true);
	} finally {
		for (const child of legacy) {
			if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
		}
		removePidLock(file);
		releaseLock(file);
		await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
}, 20_000);

it("does not steal a lock whose owner is still writing its PID", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-test-"));
	const file = join(dir, "viewer.lock");
	try {
		await writeFile(file, "");
		const pending = acquireLock(file);
		await new Promise((resolve) => setTimeout(resolve, 50));
		await writeFile(file, String(process.pid));
		expect(await pending).toBe(false);
		expect(await readFile(file, "utf8")).toBe(String(process.pid));
	} finally { releaseLock(file); await rm(dir, { recursive: true, force: true }); }
});

it("preserves an abandoned empty legacy lock for manual recovery", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-test-"));
	const file = join(dir, "viewer.lock");
	try {
		await writeFile(file, "");
		await expect(acquireLock(file)).rejects.toThrow(/Stale legacy lock/);
		expect(await readFile(file, "utf8")).toBe("");
	} finally { releaseLock(file); await rm(dir, { recursive: true, force: true }); }
});

it("does not reclaim an old lock while its owner is alive but not answering", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-test-"));
	const file = join(dir, "viewer.lock");
	try {
		await writeFile(file, String(process.pid));
		const old = new Date(Date.now() - 120_000);
		await utimes(file, old, old);
		expect(await acquireLock(file)).toBe(false);
		expect(await readFile(file, "utf8")).toBe(String(process.pid));
	} finally { releaseLock(file); await rm(dir, { recursive: true, force: true }); }
});

it("preserves a stale legacy lock whose owner has exited", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-test-"));
	const file = join(dir, "viewer.lock");
	try {
		const child = spawnSync(process.execPath, ["-e", ""]);
		expect(child.status).toBe(0);
		await writeFile(file, String(child.pid));
		await expect(acquireLock(file)).rejects.toThrow(/Stale legacy lock/);
		expect(await readFile(file, "utf8")).toBe(String(child.pid));
	} finally { releaseLock(file); await rm(dir, { recursive: true, force: true }); }
});

it("does not remove an unrecognized lock directory", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-unknown-"));
	const file = join(dir, "viewer.lock");
	try {
		await mkdir(file);
		await writeFile(join(file, "keep"), "user data");
		await expect(acquireLock(file)).rejects.toThrow(/Unrecognized lock directory/);
		expect(await readFile(join(file, "keep"), "utf8")).toBe("user data");
	} finally { releaseLock(file); await rm(dir, { recursive: true, force: true }); }
});

it("holds the gate until shutdown even if the PID file is removed", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-gate-held-"));
	const file = join(dir, "viewer.lock");
	const module = pathToFileURL(resolve("viewer/server/daemon-lock.ts")).href;
	initializeDirectoryLock(file);
	const script = `import { acquireLock } from ${JSON.stringify(module)}; if (!(await acquireLock(${JSON.stringify(file)}))) throw new Error("lock not acquired"); console.log("acquired"); setInterval(() => {}, 1000);`;
	const owner = spawn(process.execPath, [...nodeTsFlags(process.execPath), "--input-type=module", "-e", script]);
	try {
		const [data] = await once(owner.stdout, "data");
		expect(String(data)).toContain("acquired");
		await rm(join(file, "pid"));
		expect(await acquireLock(file)).toBe(false);
		const exited = once(owner, "exit");
		owner.kill();
		await exited;
		expect(await acquireLock(file)).toBe(true);
	} finally {
		if (owner.exitCode === null && owner.signalCode === null) {
			const exited = once(owner, "exit");
			owner.kill();
			await exited;
		}
		removePidLock(file);
		releaseLock(file);
		await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
}, 20_000);

it("allows only one process to recover an abandoned lock", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-race-"));
	const file = join(dir, "viewer.lock");
	const start = join(dir, "start");
	const workers: ChildProcessWithoutNullStreams[] = [];
	try {
		const previous = spawnSync(process.execPath, ["-e", ""]);
		expect(previous.status).toBe(0);
		initializeDirectoryLock(file);
		await writeFile(join(file, "pid"), String(previous.pid));
		const module = pathToFileURL(resolve("viewer/server/daemon-lock.ts")).href;
		const script = `import { acquireLock } from ${JSON.stringify(module)}; import { existsSync } from "node:fs"; console.log("ready"); while (!existsSync(${JSON.stringify(start)})) await new Promise(r => setTimeout(r, 2)); const acquired = await acquireLock(${JSON.stringify(file)}); console.log(acquired ? "acquired" : "rejected"); if (acquired) await new Promise(r => setTimeout(r, 1500));`;
		let ready = 0;
		const results = Array.from({ length: 12 }, () => new Promise<string>((done, fail) => {
			const child = spawn(process.execPath, [...nodeTsFlags(process.execPath), "--input-type=module", "-e", script]);
			workers.push(child);
			let stdout = "";
			let stderr = "";
			let announced = false;
			child.stdout.on("data", (chunk) => {
				stdout += chunk;
				if (!announced && stdout.includes("ready\n")) {
					announced = true;
					if (++ready === 12) void writeFile(start, "go").catch(fail);
				}
			});
			child.stderr.on("data", (chunk) => { stderr += chunk; });
			child.on("error", fail);
			child.on("exit", (code) => code === 0 ? done(stdout) : fail(new Error(stderr || `child exited ${code}`)));
		}));
		const output = await Promise.all(results);
		expect(output.filter((text) => text.includes("acquired"))).toHaveLength(1);
		expect(output.filter((text) => text.includes("rejected"))).toHaveLength(11);
	} finally {
		for (const worker of workers) if (worker.exitCode === null) worker.kill();
		await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
}, 20_000);

it("recovers when a process dies while holding the recovery gate", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-gate-crash-"));
	const file = join(dir, "viewer.lock");
	const script = `import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(${JSON.stringify(file)} + ".gate.sqlite"); db.exec("BEGIN IMMEDIATE"); console.log("ready"); setInterval(() => {}, 1000);`;
	const child = spawn(process.execPath, [...nodeTsFlags(process.execPath), "--input-type=module", "-e", script]);
	try {
		const [data] = await once(child.stdout, "data");
		expect(String(data)).toContain("ready");
		initializeDirectoryLock(file);
		await writeFile(join(file, "pid"), String(child.pid));
		const exited = once(child, "exit");
		child.kill();
		await exited;
		expect(await acquireLock(file)).toBe(true);
		expect(await readFile(join(file, "pid"), "utf8")).toBe(String(process.pid));
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill();
		removePidLock(file);
		releaseLock(file);
		await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
}, 20_000);

it("waits for the recovery gate owner to finish publishing its PID", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-gate-wait-"));
	const file = join(dir, "viewer.lock");
	const script = `import { DatabaseSync } from "node:sqlite"; import { writeFileSync } from "node:fs"; const db = new DatabaseSync(${JSON.stringify(file)} + ".gate.sqlite"); db.exec("BEGIN IMMEDIATE"); console.log("ready"); setTimeout(() => { writeFileSync(${JSON.stringify(file)}, String(process.pid)); db.close(); setTimeout(() => {}, 1000); }, 300);`;
	const child = spawn(process.execPath, [...nodeTsFlags(process.execPath), "--input-type=module", "-e", script]);
	try {
		const [data] = await once(child.stdout, "data");
		expect(String(data)).toContain("ready");
		expect(await acquireLock(file)).toBe(false);
		expect(await readFile(file, "utf8")).toBe(String(child.pid));
	} finally {
		if (child.exitCode === null && child.signalCode === null) {
			const exited = once(child, "exit");
			child.kill();
			await exited;
		}
		await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
}, 20_000);
