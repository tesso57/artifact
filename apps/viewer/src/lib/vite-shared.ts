/** Vite settings shared by the dev server (vite.config.ts) and the HTML exporter. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VIEWER_DIR } from "@pi-artifacts/core";

/**
 * Artifacts live outside this project (~/.pi/artifacts), so bare imports from them resolve
 * against the viewer's own dependencies (`dedupe`), and `@/…` / `@pi/artifact` point into `src/`.
 */
export function sharedResolve(extraAliases: { find: string | RegExp; replacement: string }[] = []) {
	const pkg = JSON.parse(readFileSync(resolve(VIEWER_DIR, "package.json"), "utf8")) as {
		dependencies: Record<string, string>;
	};
	return {
		dedupe: Object.keys(pkg.dependencies).filter((d) => !d.startsWith("@pi-artifacts/")),
		alias: [
			...extraAliases,
			{ find: "@pi/artifact", replacement: resolve(VIEWER_DIR, "src/sdk/index.ts") },
			{ find: "@", replacement: resolve(VIEWER_DIR, "src") },
		],
	};
}
