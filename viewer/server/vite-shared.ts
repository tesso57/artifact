/** Vite settings shared by the dev server (vite.config.ts) and the HTML exporter. */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactsDir, BUNDLED_TEMPLATES_DIR, PACKAGE_ROOT, stateDir, userTemplatesDir } from "../../shared/paths.ts";

/** The viewer app (vite root). */
export const VIEWER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The exact filesystem roots the viewer and exporter may load. */
export function filesystemPolicy(aliasRoots: string[] = []) {
	const require = createRequire(import.meta.url);
	const hoisted = dirname(dirname(realpathSync(require.resolve("vite/package.json"))));
	const nested = join(PACKAGE_ROOT, "node_modules");
	// Preserve the lexical node_modules path too: Vite may resolve an optimizer output
	// before that file exists, so its symlink target cannot yet be canonicalized.
	const dependencies = [...new Set([hoisted, ...(existsSync(nested) ? [nested, realpathSync(nested)] : [])])];
	return {
		strict: true,
		allow: [VIEWER_DIR, join(PACKAGE_ROOT, "shared"), ...dependencies, artifactsDir(), userTemplatesDir(), BUNDLED_TEMPLATES_DIR, ...aliasRoots],
		deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", `${stateDir().replaceAll("\\", "/")}/**`, "**/*.sqlite*", "**/viewer.json"],
	};
}

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
