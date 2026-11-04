import { isAbsolute, resolve } from "node:path";
import { exportArtifactHtml, readMeta } from "@pi-artifacts/core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ArtifactsRuntime } from "../runtime.ts";

export function exportTarget(cwd: string, id: string, path?: string): string {
	const p = path?.trim().replace(/^@/, "");
	if (!p) return resolve(cwd, `${id}.html`);
	return isAbsolute(p) ? p : resolve(cwd, p);
}

export function registerArtifactExport(pi: ExtensionAPI, runtime: ArtifactsRuntime): void {
	pi.registerTool({
		name: "artifact_export",
		label: "Export artifact",
		description:
			"Export an artifact as one self-contained HTML file (works offline: memory is snapshotted into localStorage, MCP results are replayed from the last fetch).",
		promptSnippet: "Export an artifact to a single self-contained HTML file",
		promptGuidelines: [
			"Use artifact_export when the user wants to share, send, attach or keep an artifact as a file. MCP calls in the export replay the results fetched in the viewer, so open the artifact in the viewer first if it has not loaded its data yet.",
		],
		parameters: Type.Object({
			id: Type.String({ description: "Artifact id" }),
			path: Type.Optional(Type.String({ description: "Output file; default <cwd>/<id>.html" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			runtime.captureToolContext(ctx);
			if (!(await readMeta(params.id))) throw new Error(`No artifact "${params.id}"`);
			const target = exportTarget(ctx.cwd, params.id, params.path);
			const { file, bytes } = await exportArtifactHtml(params.id, target, signal);
			return {
				content: [{ type: "text", text: `Exported ${params.id} to ${file} (${(bytes / 1024).toFixed(0)} KB)` }],
				details: { file, bytes },
			};
		},
		renderResult(result, { isPartial }, theme) {
			const d = result.details as { file: string; bytes: number } | undefined;
			if (isPartial || !d) return new Text(theme.fg("warning", "bundling…"), 0, 0);
			return new Text(theme.fg("success", "✓ exported ") + theme.fg("accent", d.file) + theme.fg("dim", ` · ${(d.bytes / 1024).toFixed(0)} KB`), 0, 0);
		},
	});
}
