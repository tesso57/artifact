import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { nodeTsFlags } from "../../../shared/node.ts";

it("cleans up a started Pi session if the browser fails to launch", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-e2e-startup-"));
	try {
		await expect(promisify(execFile)(process.execPath, [...nodeTsFlags(process.execPath), resolve("test/e2e/run.ts")], {
			env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root, PI_ARTIFACTS_DIR: join(root, "artifacts"), PI_ARTIFACTS_PACKAGE: resolve("."), PLAYWRIGHT_CHROMIUM: join(root, "missing-browser") }, timeout: 20_000,
		})).rejects.toThrow();
		expect(readdirSync(root).filter((name) => name.startsWith("pi-cwd-") || name.startsWith("pi-agent-"))).toEqual([]);
	} finally { rmSync(root, { recursive: true, force: true }); }
}, 25_000);
