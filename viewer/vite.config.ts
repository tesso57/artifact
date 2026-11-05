import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { artifactsDir, BUNDLED_TEMPLATES_DIR, PACKAGE_ROOT, stateDir, userTemplatesDir } from "../shared/paths.ts";
import { DaemonContext } from "./server/context.ts";
import { piArtifactsPlugin } from "./server/plugin.ts";
import { sharedResolve, VIEWER_DIR } from "./server/vite-shared.ts";

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
			allow: [VIEWER_DIR, join(PACKAGE_ROOT, "shared"), join(PACKAGE_ROOT, "node_modules"), join(PACKAGE_ROOT, ".."), artifactsDir(), userTemplatesDir(), BUNDLED_TEMPLATES_DIR],
			// Never serve daemon state (SQLite, lock, secret) even though it sits under the artifacts dir.
			deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", `${stateDir().replaceAll("\\", "/")}/**`, "**/*.sqlite*", "**/viewer.json"],
		},
	},
	resolve: sharedResolve(),
	optimizeDeps: {
		// Artifacts are not crawled at startup; pre-bundle what they may import so the
		// first artifact load does not trigger a dependency re-optimization reload.
		include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "recharts", "lucide-react", "radix-ui", "@tanstack/react-query", "@tanstack/react-table", "class-variance-authority", "clsx", "tailwind-merge"],
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
