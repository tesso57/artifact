import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Keep test data separate even when the caller configured normal-use paths. */
export function isolateTestEnvironment(env: NodeJS.ProcessEnv): { dir: string; cleanup: () => void } {
	const base = env.PI_ARTIFACTS_DIR || tmpdir();
	mkdirSync(base, { recursive: true });
	const dir = mkdtempSync(join(base, "pi-artifacts-test-"));
	let templates: string | undefined;
	try {
		if (env.PI_ARTIFACTS_TEMPLATES) {
			mkdirSync(env.PI_ARTIFACTS_TEMPLATES, { recursive: true });
			templates = mkdtempSync(join(env.PI_ARTIFACTS_TEMPLATES, "pi-templates-test-"));
		}
		env.PI_ARTIFACTS_DIR = dir;
		env.PI_ARTIFACTS_STATE = join(dir, ".state");
		env.PI_ARTIFACTS_DB = join(dir, ".state", "memory.sqlite");
		env.PI_ARTIFACTS_RUNTIME = join(dir, ".runtime");
		env.PI_ARTIFACTS_DESIGN = join(dir, ".design");
		env.PI_ARTIFACTS_TEMPLATES = templates ?? join(dir, ".templates");
		return { dir, cleanup: () => {
			if (templates) rmSync(templates, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
			rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		} };
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
}
