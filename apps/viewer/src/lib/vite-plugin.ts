import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import type { Plugin } from "vite";
import { ARTIFACTS_CHANGED_EVENT } from "./events.ts";

/**
 * Watches the artifacts directory and tells open pages when an artifact is
 * added, updated or removed (meta.json changes). Code changes of an open
 * artifact are handled by Vite's normal HMR / React Fast Refresh.
 */
/** The user's token overrides, appended after the defaults so they win. */
function userTheme(designDir: string | undefined): string {
	const file = designDir && join(designDir, "theme.css");
	return file && existsSync(file) ? `\n/* ${file} */\n${readFileSync(file, "utf8")}\n` : "";
}

/**
 * - points Tailwind at the artifacts directory (`@source "PI_ARTIFACTS_DIR"` in styles.css)
 * - appends the user design system's theme.css to styles.css
 * - tells open pages when artifacts change, and reloads them when the theme changes
 */
export function piArtifactsPlugin({ dir, designDir }: { dir: string; designDir?: string }): Plugin {
	return {
		name: "pi-artifacts",
		enforce: "pre",
		// styles.css declares `@source "PI_ARTIFACTS_DIR"`; point Tailwind at the real directory.
		transform(code, id) {
			if (!id.split("?")[0].endsWith("/src/styles.css")) return;
			const source = `@source ${JSON.stringify(dir.replaceAll("\\", "/"))};`;
			return code.replace('@source "PI_ARTIFACTS_DIR";', source) + userTheme(designDir);
		},
		configureServer(server) {
			server.watcher.add(dir);
			const themeFile = designDir && join(designDir, "theme.css");
			if (themeFile) server.watcher.add(themeFile);
			const notify = (file: string) => {
				if (file === themeFile) {
					// styles.css inlines the theme: re-transform it and reload pages.
					for (const env of Object.values(server.environments)) {
						for (const m of env.moduleGraph.idToModuleMap.values()) {
							if (m.id?.split("?")[0].endsWith("/src/styles.css")) env.moduleGraph.invalidateModule(m);
						}
					}
					server.ws.send({ type: "full-reload" });
					return;
				}
				const rel = relative(dir, file);
				if (rel.startsWith("..") || basename(file) !== "meta.json") return;
				const id = dirname(rel).split(sep)[0];
				server.ws.send({ type: "custom", event: ARTIFACTS_CHANGED_EVENT, data: { id } });
			};
			server.watcher.on("add", notify);
			server.watcher.on("change", notify);
			server.watcher.on("unlink", notify);
		},
	};
}
