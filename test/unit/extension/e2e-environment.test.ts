import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { isolateTestEnvironment } from "../../e2e/environment.ts";

it("isolates test state and artifacts from existing configured locations", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-test-isolation-"));
	const sentinel = join(root, "keep.txt");
	writeFileSync(sentinel, "keep");
	try {
		const env: NodeJS.ProcessEnv = { PI_ARTIFACTS_DIR: root, PI_ARTIFACTS_TEMPLATES: root, PI_ARTIFACTS_STATE: root, PI_ARTIFACTS_DB: sentinel, PI_ARTIFACTS_DESIGN: root, PI_ARTIFACTS_RUNTIME: root };
		const sandbox = isolateTestEnvironment(env);
		expect(env.PI_ARTIFACTS_DIR).not.toBe(root);
		expect(env.PI_ARTIFACTS_STATE).toBe(join(sandbox.dir, ".state"));
		expect(env.PI_ARTIFACTS_DB).toBe(join(sandbox.dir, ".state", "memory.sqlite"));
		expect(env.PI_ARTIFACTS_DESIGN).toBe(join(sandbox.dir, ".design"));
		expect(env.PI_ARTIFACTS_RUNTIME).toBe(join(sandbox.dir, ".runtime"));
		expect(env.PI_ARTIFACTS_TEMPLATES).not.toBe(root);
		sandbox.cleanup();
		expect(existsSync(sandbox.dir)).toBe(false);
		expect(readFileSync(sentinel, "utf8")).toBe("keep");
	} finally { rmSync(root, { recursive: true, force: true }); }
});
