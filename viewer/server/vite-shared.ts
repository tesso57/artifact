/** Vite settings shared by the dev server (vite.config.ts) and the HTML exporter. */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_ROOT } from "../../shared/paths.ts";

/** The viewer app (vite root). */
export const VIEWER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Packages artifacts may import: the package's runtime dependencies. */
function artifactDependencies(): string[] {
	const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
		dependencies: Record<string, string>;
	};
	return Object.keys(pkg.dependencies);
}

/**
 * Artifacts live outside the viewer (~/.pi/artifacts), so bare imports from them resolve
 * against the viewer's dependencies (`dedupe`), and `@/…` / `@pi/artifact` point into `src/`.
 */
export function sharedResolve(extraAliases: { find: string | RegExp; replacement: string }[] = []) {
	return {
		dedupe: artifactDependencies(),
		alias: [
			...extraAliases,
			{ find: "@pi/artifact", replacement: join(VIEWER_DIR, "src/sdk/index.ts") },
			{ find: "@", replacement: join(VIEWER_DIR, "src") },
		],
	};
}
