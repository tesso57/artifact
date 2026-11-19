import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactsDir, BUNDLED_TEMPLATES_DIR, PACKAGE_ROOT, stateDir, userTemplatesDir } from "../../shared/paths.ts";

export const VIEWER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function filesystemPolicy(aliasRoots: string[] = []) {
	const require = createRequire(import.meta.url);
	const hoisted = dirname(dirname(realpathSync(require.resolve("vite/package.json"))));
	const nested = join(PACKAGE_ROOT, "node_modules");
	const dependencies = [...new Set([hoisted, ...(existsSync(nested) ? [nested, realpathSync(nested)] : [])])];
	return {
		strict: true,
		allow: [VIEWER_DIR, join(PACKAGE_ROOT, "shared"), ...dependencies, artifactsDir(), userTemplatesDir(), BUNDLED_TEMPLATES_DIR, ...aliasRoots],
		deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", `${stateDir().replaceAll("\\", "/")}/**`, "**/*.sqlite*", "**/viewer.json"],
	};
}

function artifactDependencies(): string[] {
	const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
		dependencies: Record<string, string>;
	};
	return Object.keys(pkg.dependencies);
}

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
