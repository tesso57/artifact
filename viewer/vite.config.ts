import { join } from "node:path";
import { createHash } from "node:crypto";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { artifactsDir, BUNDLED_TEMPLATES_DIR, PACKAGE_ROOT, stateDir, userTemplatesDir } from "../shared/paths.ts";
import { resolvePhysicalPath, runtimeNeedsPreserveSymlinks } from "../shared/node.ts";
import { DaemonContext } from "./server/context.ts";
import { piArtifactsPlugin } from "./server/plugin.ts";
import { filesystemPolicy, sharedResolve, VIEWER_DIR } from "./server/vite-shared.ts";

const ctx = (() => {
	try {
		return DaemonContext.current();
	} catch {
		return undefined; // e.g. `vite build` or tooling loading the config
	}
})();

const cachePath = join(artifactsDir(), ".vite-cache", createHash("sha256").update(resolvePhysicalPath(stateDir())).digest("hex").slice(0, 20));

export default defineConfig({
	// Separate viewer instances must not rewrite each other's optimized dependencies.
	cacheDir: ctx?.aliases.map(cachePath) ?? cachePath,
	server: {
		host: "127.0.0.1",
		cors: false,
		fs: filesystemPolicy(ctx?.aliases.paths),
	},
	resolve: { ...sharedResolve(), preserveSymlinks: !!ctx?.aliases.paths.length || runtimeNeedsPreserveSymlinks(PACKAGE_ROOT) },
	optimizeDeps: {
		// Artifacts are not crawled at startup; pre-bundle what they may import so the
		// first artifact load does not trigger a dependency re-optimization reload.
		include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "recharts", "lucide-react", "radix-ui", "@tanstack/react-query", "@tanstack/react-table", "class-variance-authority", "clsx", "tailwind-merge", "mermaid", "react-markdown", "remark-gfm"],
	},
	plugins: [
		piArtifactsPlugin({
			ctx,
			sources: [join(artifactsDir(), "*/index.tsx"), join(userTemplatesDir(), "*/template.tsx"), join(BUNDLED_TEMPLATES_DIR, "*/template.tsx")],
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});
