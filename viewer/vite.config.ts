import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { artifactsDir, BUNDLED_TEMPLATES_DIR, PACKAGE_ROOT, stateDir, userTemplatesDir } from "../shared/paths.ts";
import { DaemonContext } from "./server/context.ts";
import { piArtifactsPlugin } from "./server/plugin.ts";
import { sharedResolve, VIEWER_DIR } from "./server/vite-shared.ts";

/** The node_modules folders the viewer's dependencies really live in (no parent folders). */
function dependencyDirs(): string[] {
	const require = createRequire(import.meta.url);
	const hoisted = dirname(dirname(realpathSync(require.resolve("vite/package.json"))));
	const nested = join(PACKAGE_ROOT, "node_modules");
	return [...new Set([hoisted, ...(existsSync(nested) ? [realpathSync(nested)] : [])])];
}

const ctx = (() => {
	try {
		return DaemonContext.current();
	} catch {
		return undefined; // e.g. `vite build` or tooling loading the config
	}
})();

export default defineConfig({
	server: {
		host: "127.0.0.1",
		cors: false,
		fs: {
			strict: true,
			// Exactly what the app needs: its own sources, its dependencies, artifacts and templates.
			allow: [VIEWER_DIR, join(PACKAGE_ROOT, "shared"), ...dependencyDirs(), artifactsDir(), userTemplatesDir(), BUNDLED_TEMPLATES_DIR],
			// Never serve daemon state (SQLite, lock, secret) even though it sits under the artifacts dir.
			deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", `${stateDir().replaceAll("\\", "/")}/**`, "**/*.sqlite*", "**/viewer.json"],
		},
	},
	resolve: sharedResolve(),
	optimizeDeps: {
		// Artifacts are not crawled at startup; pre-bundle what they may import so the
		// first artifact load does not trigger a dependency re-optimization reload.
		include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "recharts", "lucide-react", "radix-ui", "@tanstack/react-query", "@tanstack/react-table", "class-variance-authority", "clsx", "tailwind-merge", "mermaid"],
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
