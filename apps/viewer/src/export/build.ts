/**
 * Export one artifact as a single, self-contained HTML file: the artifact, React, the
 * SDK (static backend), shadcn/ui and the Tailwind CSS it uses are bundled and inlined,
 * together with a snapshot of its memory and of the MCP results it last fetched.
 *
 * Runs in Node (the viewer's server functions and `scripts/export.ts`).
 */
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { artifactPaths, designDir, getMemory, MCP_CACHE_SCOPE, type McpCallResult, readMeta, VIEWER_DIR } from "@pi-artifacts/core";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { build, type Plugin, type Rollup } from "vite";
import { piArtifactsPlugin } from "../lib/vite-plugin.ts";
import { sharedResolve } from "../lib/vite-shared.ts";
import type { ArtifactSnapshot } from "./snapshot.ts";

const ENTRY = "virtual:pi-artifact-export";

interface ExportResult {
	html: string;
	bytes: number;
	file?: string;
}

/** Memory and MCP results to embed. */
function collectSnapshot(meta: { id: string; title: string; description?: string }): ArtifactSnapshot {
	const mem = getMemory();
	const memory = [meta.id, "shared"].flatMap((scope) =>
		mem.list(scope).map((e) => ({ scope, key: e.key, value: e.value, updatedAt: e.updatedAt })),
	);
	const mcp: Record<string, McpCallResult> = {};
	for (const e of mem.list(MCP_CACHE_SCOPE, `${meta.id} `)) mcp[e.key] = e.value as McpCallResult;
	return {
		artifact: { id: meta.id, title: meta.title, description: meta.description },
		exportedAt: Date.now(),
		memory,
		mcp,
	};
}

/** `</script>` and `<!--` must not appear inside inline scripts. */
export function escapeInlineScript(code: string): string {
	return code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

export function renderHtml(opts: { title: string; css: string; js: string; snapshot: ArtifactSnapshot }): string {
	const data = JSON.stringify(opts.snapshot).replace(/</g, "\\u003c");
	const title = opts.title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="pi-artifacts" />
<title>${title}</title>
<style>${opts.css.replace(/<\/(style)/gi, "<\\/$1")}</style>
<script>window.__PI_ARTIFACT__ = ${data};</script>
</head>
<body class="min-h-dvh">
<div id="root"></div>
<script type="module">${escapeInlineScript(opts.js)}</script>
</body>
</html>
`;
}

function entryPlugin(artifactEntry: string): Plugin {
	return {
		name: "pi-artifact-export-entry",
		resolveId: (id) => (id === ENTRY ? `\0${ENTRY}` : undefined),
		load: (id) =>
			id === `\0${ENTRY}`
				? `import { mount } from ${JSON.stringify(resolve(VIEWER_DIR, "src/export/entry.tsx"))};
import Artifact from ${JSON.stringify(artifactEntry)};
mount(Artifact);`
				: undefined,
	};
}

export async function exportArtifact(id: string, outFile?: string): Promise<ExportResult> {
	const meta = await readMeta(id);
	if (!meta) throw new Error(`Artifact "${id}" not found`);
	const { dir, entry } = artifactPaths(id);

	const output = (await build({
		configFile: false,
		root: VIEWER_DIR,
		mode: "production",
		logLevel: "warn",
		resolve: sharedResolve([
			{ find: /^@\/sdk\/backend$/, replacement: resolve(VIEWER_DIR, "src/export/static-backend.ts") },
		]),
		// Tailwind only needs to see this artifact (plus the viewer's own sources).
		plugins: [entryPlugin(entry), piArtifactsPlugin({ dir, designDir: designDir() }), tailwindcss(), viteReact()],
		build: {
			write: false,
			outDir: resolve(dirname(entry), ".export"),
			emptyOutDir: false,
			cssCodeSplit: false,
			modulePreload: false,
			assetsInlineLimit: Number.MAX_SAFE_INTEGER,
			reportCompressedSize: false,
			rollupOptions: {
				input: ENTRY,
				// One chunk: everything is inlined into the page.
				output: { codeSplitting: false, format: "es" } as Rollup.OutputOptions,
			},
		},
	})) as Rollup.RollupOutput | Rollup.RollupOutput[];

	const files = (Array.isArray(output) ? output : [output]).flatMap((o) => o.output);
	const js = files
		.filter((f): f is Rollup.OutputChunk => f.type === "chunk")
		.map((c) => c.code)
		.join("\n");
	const css = files
		.filter((f): f is Rollup.OutputAsset => f.type === "asset" && f.fileName.endsWith(".css"))
		.map((a) => String(a.source))
		.join("\n");
	if (!js) throw new Error("Export produced no JavaScript");

	const html = renderHtml({ title: meta.title, css, js, snapshot: collectSnapshot(meta) });
	const result: ExportResult = { html, bytes: Buffer.byteLength(html) };
	if (outFile) {
		await writeFile(outFile, html, "utf8");
		result.file = outFile;
	}
	return result;
}
