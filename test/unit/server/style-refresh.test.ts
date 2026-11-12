import { join } from "node:path";
import type { ViteDevServer } from "vite";
import { normalizePath } from "vite";
import { expect, it, vi } from "vitest";
import { DaemonContext } from "../../../viewer/server/context.ts";
import { Memory } from "../../../viewer/server/memory.ts";
import { VIEWER_DIR } from "../../../viewer/server/vite-shared.ts";

it("refreshes the stylesheet using Vite's normalized file path", async () => {
	const context = new DaemonContext("test", new Memory(":memory:"));
	const stylesheet = {};
	const file = normalizePath(join(VIEWER_DIR, "src/styles.css"));
	const invalidate = vi.fn();
	const transform = vi.fn(async () => null);
	const send = vi.fn();
	const graph = {
		getModulesByFile: (path: string) => path === file ? new Set([stylesheet]) : undefined,
		invalidateModule: invalidate,
	};
	context.server = { environments: { client: { moduleGraph: graph, transformRequest: transform } }, ws: { send } } as unknown as ViteDevServer;
	await context.refreshStyles();
	expect(invalidate).toHaveBeenCalledWith(stylesheet);
	expect(transform).toHaveBeenCalledWith("/src/styles.css?direct");
	expect(send).toHaveBeenCalledOnce();
});
