import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { acquireLock, releaseLock } from "../../../viewer/server/daemon-lock.ts";
import { nodeTsFlags } from "../../../shared/node.ts";

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

it("recovers an abandoned empty lock after the initialization window", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-test-"));
	const file = join(dir, "viewer.lock");
	try {
		await writeFile(file, "");
		expect(await acquireLock(file)).toBe(true);
		expect(await readFile(file, "utf8")).toBe(String(process.pid));
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

it("recovers a lock whose owner has exited", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-test-"));
	const file = join(dir, "viewer.lock");
	try {
		const child = spawnSync(process.execPath, ["-e", ""]);
		expect(child.status).toBe(0);
		await writeFile(file, String(child.pid));
		expect(await acquireLock(file)).toBe(true);
		expect(await readFile(file, "utf8")).toBe(String(process.pid));
	} finally { releaseLock(file); await rm(dir, { recursive: true, force: true }); }
});

it("holds the gate until shutdown even if the PID file is removed", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-gate-held-"));
	const file = join(dir, "viewer.lock");
	try {
		expect(await acquireLock(file)).toBe(true);
		await rm(file);
		expect(await acquireLock(file)).toBe(false);
		releaseLock(file);
		expect(await acquireLock(file)).toBe(true);
	} finally {
		releaseLock(file);
		await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
}, 15_000);

it("allows only one process to recover an abandoned lock", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-race-"));
	const file = join(dir, "viewer.lock");
	const start = join(dir, "start");
	const workers: ChildProcessWithoutNullStreams[] = [];
	try {
		const previous = spawnSync(process.execPath, ["-e", ""]);
		expect(previous.status).toBe(0);
		await writeFile(file, String(previous.pid));
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
		await writeFile(file, String(child.pid));
		const exited = once(child, "exit");
		child.kill();
		await exited;
		expect(await acquireLock(file)).toBe(true);
		expect(await readFile(file, "utf8")).toBe(String(process.pid));
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill();
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
