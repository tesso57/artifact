import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { piArtifactsPlugin } from "./src/lib/vite-plugin.ts";
import { artifactsDir as getArtifactsDir } from "@pi-artifacts/core";
import { sharedResolve } from "./src/lib/vite-shared.ts";

const artifactsDir = getArtifactsDir();

export default defineConfig({
	server: {
		host: "127.0.0.1",
		port: Number(process.env.PORT ?? 5178),
		fs: { allow: [resolve(import.meta.dirname, "../.."), artifactsDir] },
	},
	resolve: sharedResolve(),
	optimizeDeps: {
		// Artifacts are not crawled at startup; pre-bundle what they may import so the
		// first artifact load does not trigger a dependency re-optimization reload.
		include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "recharts", "lucide-react", "radix-ui", "@tanstack/react-query", "@tanstack/react-table", "class-variance-authority", "clsx", "tailwind-merge"],
	},
	plugins: [piArtifactsPlugin({ dir: artifactsDir }), tailwindcss(), tanstackStart(), viteReact()],
});
