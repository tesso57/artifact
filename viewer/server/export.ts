/**
 * Export one artifact as a single, self-contained HTML file: the artifact, React, the
 * SDK (static backend), shadcn/ui and the Tailwind CSS it uses are bundled and inlined,
 * together with a snapshot of its memory and of the MCP results it last fetched.
 *
 * The daemon collects the snapshot and assembles the page; bundling runs in a worker.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { build, type Plugin, type Rollup } from "vite";
import { SHARED_SCOPE } from "../../shared/ids.ts";
import { runtimeNeedsPreserveSymlinks } from "../../shared/node.ts";
import { PACKAGE_ROOT } from "../../shared/paths.ts";
import { mcpAllowed, type ArtifactMeta } from "../../shared/protocol.ts";
import type { ArtifactSnapshot } from "../src/export/snapshot.ts";
import type { Memory } from "./memory.ts";
import { piArtifactsPlugin } from "./plugin.ts";
import { filesystemPolicy, sharedResolve, VIEWER_DIR } from "./vite-shared.ts";
import { needsVirtualModule } from "./virtual-modules.ts";
import { writeExportFile } from "./export-file.ts";

const ENTRY = "virtual:pi-artifact-export";
const VIRTUAL_ARTIFACT = "/__pi_virtual_export__/artifact.tsx";

export interface ExportResult {
	html: string;
	bytes: number;
	file?: string;
	/** What the file contains besides code, so the user can decide whether to share it. */
	embedded: { memoryKeys: string[]; sharedKeys: string[]; mcpCalls: string[] };
}

/** The artifact's own memory, the shared keys it read, and its cached MCP results. */
export function collectSnapshot(memory: Memory, meta: Pick<ArtifactMeta, "id" | "title" | "description" | "mcp">): ArtifactSnapshot {
	const own = memory.list(meta.id);
	const shared = memory.listReadShared(meta.id);
	return {
		artifact: { id: meta.id, title: meta.title, description: meta.description },
		exportedAt: Date.now(),
		snapshotId: randomUUID(),
		memory: [...own, ...shared].map((e) => ({ scope: e.scope, key: e.key, value: e.value, updatedAt: e.updatedAt })),
		mcp: Object.fromEntries(Object.entries(memory.mcpCache(meta.id)).filter(([key]) => {
			const separator = key.indexOf(" ");
			return separator > 0 && mcpAllowed(meta.mcp, key.slice(0, separator));
		})),
	};
}

/** `</script>` and `<!--` must not appear inside inline scripts. */
export function escapeInlineScript(code: string): string {
	return code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

export function renderHtml(opts: { title: string; css: string; js: string; snapshot: ArtifactSnapshot }): string {
	// Parse JSON at runtime: object literals treat a "__proto__" key as a prototype setter.
	const data = JSON.stringify(JSON.stringify(opts.snapshot)).replace(/</g, "\\u003c");
	const title = opts.title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="pi-artifacts" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'" />
<title>${title}</title>
<style>${opts.css.replace(/<\/(style)/gi, "<\\/$1")}</style>
<script>window.__PI_ARTIFACT__ = JSON.parse(${data});</script>
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
		resolveId: (id) => id === ENTRY ? `\0${ENTRY}` : id === VIRTUAL_ARTIFACT ? VIRTUAL_ARTIFACT : undefined,
		load: async (id) => {
			if (id === VIRTUAL_ARTIFACT) return readFile(artifactEntry, "utf8");
			if (id === `\0${ENTRY}`) return `import { mount } from ${JSON.stringify(join(VIEWER_DIR, "src/export/entry.tsx"))};
import Artifact from ${JSON.stringify(needsVirtualModule(artifactEntry) ? VIRTUAL_ARTIFACT : artifactEntry)};
mount(Artifact);`;
		},
	};
}

/** Bundle an artifact's code and CSS (runs in the export worker, NODE_ENV=production). */
export async function bundleArtifact(entry: string, sources: string[], aliasRoots: string[] = []): Promise<{ js: string; css: string }> {
	const output = (await build({
		configFile: false,
		root: VIEWER_DIR,
		mode: "production",
		logLevel: "warn",
		server: { fs: filesystemPolicy(aliasRoots) },
		resolve: { ...sharedResolve([
			{ find: /^@\/sdk\/backend$/, replacement: join(VIEWER_DIR, "src/export/static-backend.ts") },
		]), preserveSymlinks: aliasRoots.length > 0 || runtimeNeedsPreserveSymlinks(PACKAGE_ROOT) },
		// Tailwind only needs to see this artifact (plus the viewer's own sources).
		plugins: [entryPlugin(entry), piArtifactsPlugin({ sources, virtualSource: needsVirtualModule(entry) ? { id: VIRTUAL_ARTIFACT, file: entry } : undefined }), tailwindcss(), viteReact()],
		build: {
			write: false,
			outDir: join(dirname(entry), ".export"),
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
	return { js, css };
}

/**
 * The daemon runs a dev server with NODE_ENV=development, which would make React's plugin
 * emit development JSX; bundling therefore runs in a short-lived worker process.
 */
function bundleInWorker(entry: string, sources: string[], aliasRoots: string[]): Promise<{ js: string; css: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [...process.execArgv, join(VIEWER_DIR, "server", "export-worker.ts")], {
			cwd: VIEWER_DIR,
			env: { ...process.env, NODE_ENV: "production" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let out = "";
		let err = "";
		child.stdout.on("data", (d: Buffer) => (out += d));
		child.stderr.on("data", (d: Buffer) => (err += d));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				try {
					return resolve(JSON.parse(out) as { js: string; css: string });
				} catch {}
			}
			reject(new Error(err.trim().split("\n").slice(-15).join("\n") || `Export worker exited with code ${code}`));
		});
		child.stdin.end(JSON.stringify({ entry, sources, aliasRoots }));
	});
}

export async function exportArtifact(
	memory: Memory,
	meta: ArtifactMeta,
	entry: string,
	opts: { themeCss?: string; outFile?: string; overwrite?: boolean; aliasRoots?: string[] } = {},
): Promise<ExportResult> {
	const bundle = await bundleInWorker(entry, [entry], opts.aliasRoots ?? []);
	const css = [bundle.css, opts.themeCss ?? ""].filter(Boolean).join("\n");
	const snapshot = collectSnapshot(memory, meta);
	const html = renderHtml({ title: meta.title, css, js: bundle.js, snapshot });
	const result: ExportResult = {
		html,
		bytes: Buffer.byteLength(html),
		embedded: {
			memoryKeys: snapshot.memory.filter((m) => m.scope === meta.id).map((m) => m.key),
			sharedKeys: snapshot.memory.filter((m) => m.scope === SHARED_SCOPE).map((m) => m.key),
			mcpCalls: Object.keys(snapshot.mcp),
		},
	};
	if (opts.outFile) {
		await writeExportFile(opts.outFile, html, opts.overwrite === true);
		result.file = opts.outFile;
	}
	return result;
}
