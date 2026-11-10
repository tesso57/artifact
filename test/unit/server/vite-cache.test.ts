import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { nodeTsFlags } from "../../../shared/node.ts";

it("isolates Vite caches for daemons with different state directories", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-vite-cache-test-"));
	try {
		const config = resolve("viewer/vite.config.ts");
		const script = `import { resolveConfig } from "vite"; const c = await resolveConfig({root:${JSON.stringify(resolve("viewer"))}, configFile:${JSON.stringify(config)}, configLoader:"native"}, "serve"); console.log(c.cacheDir);`;
		const cache = (name: string) => execFileSync(process.execPath, [...nodeTsFlags(process.execPath), "--input-type=module", "-e", script], {
			env: { ...process.env, PI_ARTIFACTS_DIR: join(root, "artifacts"), PI_ARTIFACTS_STATE: join(root, name, ".state") }, encoding: "utf8",
		}).trim();
		expect(cache("first")).not.toBe(cache("second"));
	} finally { rmSync(root, { recursive: true, force: true }); }
}, 20_000);
