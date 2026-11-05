import { basename, dirname, join, relative, sep } from "node:path";
import type { Plugin } from "vite";
import { artifactsDir, designDir } from "../../shared/paths.ts";
import { ARTIFACTS_CHANGED_EVENT } from "../src/lib/events.ts";
import { apiMiddleware, guardMiddleware } from "./api.ts";
import type { DaemonContext } from "./context.ts";

const SOURCE_PLACEHOLDER = '@source "PI_ARTIFACTS_SOURCES";';

/**
 * - points Tailwind at artifact sources (`@source "PI_ARTIFACTS_SOURCES"` in styles.css)
 * - with a daemon context: authentication, security headers, the `/__pi/*` API,
 *   and change notifications for artifacts and the design system's theme.css
 */
export function piArtifactsPlugin({ sources, ctx }: { sources: string[]; ctx?: DaemonContext }): Plugin {
	return {
		name: "pi-artifacts",
		enforce: "pre",
		transform(code, id) {
			// Only the CSS source itself — not `styles.css?url`, which is a JS module.
			if (!id.split("?")[0].endsWith("/src/styles.css") || !code.includes(SOURCE_PLACEHOLDER)) return;
			const lines = sources.map((s) => `@source ${JSON.stringify(s.replaceAll("\\", "/"))};`).join("\n");
			return code.replace(SOURCE_PLACEHOLDER, lines);
		},
		configureServer(server) {
			if (!ctx) return;
			ctx.server = server;
			server.middlewares.use(guardMiddleware(ctx));
			server.middlewares.use(apiMiddleware(ctx));

			const dir = artifactsDir();
			const themeFile = join(designDir(), "theme.css");
			server.watcher.add([dir, themeFile]);
			const notify = (file: string) => {
				if (file === themeFile) return server.ws.send({ type: "full-reload" });
				const rel = relative(dir, file);
				if (rel.startsWith("..") || basename(file) !== "meta.json") return;
				server.ws.send({ type: "custom", event: ARTIFACTS_CHANGED_EVENT, data: { id: dirname(rel).split(sep)[0] } });
			};
			server.watcher.on("add", notify);
			server.watcher.on("change", notify);
			server.watcher.on("unlink", notify);
		},
	};
}
