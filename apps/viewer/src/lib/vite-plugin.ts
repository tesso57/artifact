import { basename, dirname, relative, sep } from "node:path";
import type { Plugin } from "vite";

/** Custom HMR events the viewer listens to. */
export const ARTIFACTS_CHANGED_EVENT = "pi-artifacts:changed";

/**
 * Watches the artifacts directory and tells open pages when an artifact is
 * added, updated or removed (meta.json changes). Code changes of an open
 * artifact are handled by Vite's normal HMR / React Fast Refresh.
 */
export function piArtifactsPlugin({ dir }: { dir: string }): Plugin {
	return {
		name: "pi-artifacts",
		enforce: "pre",
		// styles.css declares `@source "PI_ARTIFACTS_DIR"`; point Tailwind at the real directory.
		transform(code, id) {
			if (!id.split("?")[0].endsWith("/src/styles.css")) return;
			return code.replace('@source "PI_ARTIFACTS_DIR";', `@source ${JSON.stringify(dir.replaceAll("\\", "/"))};`);
		},
		configureServer(server) {
			server.watcher.add(dir);
			const notify = (file: string) => {
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
