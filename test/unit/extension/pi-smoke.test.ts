import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

it("loads the extension in Pi and registers its command and tools", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-artifacts-smoke-"));
	try {
		const path = resolve("extension/index.ts");
		const loader = new DefaultResourceLoader({
			cwd: dir, agentDir: join(dir, "agent"), additionalExtensionPaths: [path],
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		});
		await loader.reload();
		const result = loader.getExtensions();
		expect(result.errors).toEqual([]);
		const extension = result.extensions.find((item) => item.resolvedPath === path);
		expect(extension).toBeDefined();
		expect(extension!.commands.has("artifacts")).toBe(true);
		for (const name of ["artifact_write", "artifact_link", "artifact_memory", "artifact_template", "artifact_export"]) {
			expect(extension!.tools.has(name)).toBe(true);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
