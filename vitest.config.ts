import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	resolve: { alias: { "@": fileURLToPath(new URL("./viewer/src", import.meta.url)) } },
	test: {
		include: ["test/unit/**/*.test.ts"],
		environment: "node",
	},
});
