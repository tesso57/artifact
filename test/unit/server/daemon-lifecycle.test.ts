import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { DAEMON_SECRET_HEADER } from "../../../shared/protocol.ts";

it("keeps an unused link alive beyond idle shutdown, then exits after it is used", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-daemon-lifecycle-"));
	const stateFile = join(dir, ".state", "viewer.json");
	const daemon = spawn(process.execPath, [fileURLToPath(new URL("../../../viewer/server/daemon.ts", import.meta.url))], {
		env: { ...process.env, PI_ARTIFACTS_DIR: dir, PI_ARTIFACTS_STATE: join(dir, ".state"), PI_ARTIFACTS_DB: join(dir, ".state", "memory.sqlite"), PI_ARTIFACTS_TEMPLATES: join(dir, ".templates"), PI_ARTIFACTS_DESIGN: join(dir, ".design"), PI_ARTIFACTS_IDLE_MS: "1500", PI_ARTIFACTS_PORT: "5178" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	daemon.stdout.on("data", (chunk) => { output += chunk; });
	daemon.stderr.on("data", (chunk) => { output += chunk; });
	const exited = new Promise<void>((resolve) => daemon.once("exit", () => resolve()));
	try {
		const deadline = Date.now() + 15_000;
		while (!existsSync(stateFile) && daemon.exitCode === null && Date.now() < deadline) await delay(50);
		if (!existsSync(stateFile)) throw new Error(`daemon did not start: ${output}`);
		const state = JSON.parse(readFileSync(stateFile, "utf8")) as { url: string; secret: string };
		const response = await fetch(`${state.url}/__pi/api/link`, { method: "POST", headers: { [DAEMON_SECRET_HEADER]: state.secret, "content-type": "application/json" }, body: JSON.stringify({ next: "/a/test" }) });
		expect(response.ok).toBe(true);
		const { url } = await response.json() as { url: string };
		await delay(3500);
		expect(daemon.exitCode).toBeNull();
		const login = await fetch(url, { redirect: "manual" });
		expect(login.status).toBe(302);
		expect(login.headers.get("location")).toBe("/a/test");
		await Promise.race([exited, delay(6000).then(() => { throw new Error(`daemon did not exit after link use: ${output}`); })]);
		expect(daemon.exitCode).toBe(0);
	} finally {
		if (daemon.exitCode === null) { daemon.kill("SIGTERM"); await exited; }
		rmSync(dir, { recursive: true, force: true });
	}
}, 25_000);
