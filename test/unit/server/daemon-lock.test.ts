import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { acquireLock } from "../../../viewer/server/daemon-lock.ts";

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
	} finally { await rm(dir, { recursive: true, force: true }); }
});

it("recovers an abandoned empty lock after the initialization window", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-lock-test-"));
	const file = join(dir, "viewer.lock");
	try {
		await writeFile(file, "");
		expect(await acquireLock(file)).toBe(true);
		expect(await readFile(file, "utf8")).toBe(String(process.pid));
	} finally { await rm(dir, { recursive: true, force: true }); }
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
	} finally { await rm(dir, { recursive: true, force: true }); }
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
	} finally { await rm(dir, { recursive: true, force: true }); }
});
