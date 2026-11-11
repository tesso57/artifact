import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { DaemonClient } from "../../../extension/daemon-client.ts";

it("reports a stale legacy lock promptly even when an old state file remains", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-legacy-lock-error-"));
	const state = join(dir, ".state");
	mkdirSync(state);
	const dead = spawnSync(process.execPath, ["-e", ""]);
	expect(dead.status).toBe(0);
	const settings: Record<string, string> = {
		PI_ARTIFACTS_DIR: dir, PI_ARTIFACTS_STATE: state, PI_ARTIFACTS_DB: join(state, "memory.sqlite"),
		PI_ARTIFACTS_TEMPLATES: join(dir, ".templates"), PI_ARTIFACTS_DESIGN: join(dir, ".design"),
		PI_ARTIFACTS_RUNTIME: join(dir, ".runtime"), PI_ARTIFACTS_NODE: process.execPath,
	};
	const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
	Object.assign(process.env, settings);
	const lock = join(state, "viewer.lock");
	writeFileSync(lock, String(dead.pid));
	writeFileSync(join(state, "viewer.json"), JSON.stringify({ protocol: 1, pid: dead.pid, port: 9, url: "http://127.0.0.1:9", secret: "test-secret", version: "0.3.0", startedAt: 0 }));
	try {
		const start = performance.now();
		await expect(new DaemonClient().ensure()).rejects.toThrow(/Stale legacy lock.*stop all old pi sessions/);
		expect(performance.now() - start).toBeLessThan(5000);
		expect(readFileSync(lock, "utf8")).toBe(String(dead.pid));
	} finally {
		for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
		rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
}, 10_000);
