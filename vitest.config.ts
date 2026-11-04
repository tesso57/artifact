import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{ test: { name: "core", include: ["packages/core/test/**/*.test.ts"], environment: "node" } },
			{ test: { name: "extension", include: ["packages/extension/test/**/*.test.ts"], environment: "node" } },
		],
	},
});
