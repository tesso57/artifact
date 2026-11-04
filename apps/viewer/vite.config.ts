import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { piArtifactsPlugin } from "./src/lib/vite-plugin.ts";

const artifactsDir = process.env.PI_ARTIFACTS_DIR ?? resolve(homedir(), ".pi", "artifacts");

// Artifacts live outside this project (~/.pi/artifacts), so bare imports from them must
// resolve against the viewer's own dependencies.
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8")) as {
	dependencies: Record<string, string>;
};
const deps = Object.keys(pkg.dependencies).filter((d) => !d.startsWith("@pi-artifacts/"));

export default defineConfig({
	server: {
		host: "127.0.0.1",
		port: Number(process.env.PORT ?? 5178),
		fs: { allow: [resolve(import.meta.dirname, "../.."), artifactsDir] },
	},
	resolve: {
		dedupe: deps,
		alias: {
			"@": resolve(import.meta.dirname, "src"),
			"@pi/artifact": resolve(import.meta.dirname, "src/sdk/index.ts"),
		},
	},
	optimizeDeps: {
		// Artifacts are not crawled at startup; pre-bundle what they may import so the
		// first artifact load does not trigger a dependency re-optimization reload.
		include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "recharts", "lucide-react", "radix-ui", "@tanstack/react-query", "@tanstack/react-table", "class-variance-authority", "clsx", "tailwind-merge"],
	},
	plugins: [piArtifactsPlugin({ dir: artifactsDir }), tailwindcss(), tanstackStart(), viteReact()],
});
