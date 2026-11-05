import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ArtifactsRuntime } from "../runtime.ts";

export function exportTarget(cwd: string, id: string, path?: string): string {
	const p = path?.trim().replace(/^@/, "");
	if (!p) return resolve(cwd, `${id}.html`);
	return isAbsolute(p) ? p : resolve(cwd, p);
}

export interface ExportResponse {
	file: string;
	bytes: number;
	embedded: { memoryKeys: string[]; sharedKeys: string[]; mcpCalls: string[] };
}

export function formatExport(r: ExportResponse): string {
	const e = r.embedded;
	return [
		`Exported to ${r.file} (${(r.bytes / 1024).toFixed(0)} KB).`,
		`Embedded data — mention it before the file is shared: ${e.memoryKeys.length} memory key(s)${e.memoryKeys.length ? ` (${e.memoryKeys.join(", ")})` : ""}, ${e.sharedKeys.length} shared key(s)${e.sharedKeys.length ? ` (${e.sharedKeys.join(", ")})` : ""}, ${e.mcpCalls.length} MCP result(s).`,
	].join("\n");
}

export function registerArtifactExport(pi: ExtensionAPI, runtime: ArtifactsRuntime): void {
	pi.registerTool({
		name: "artifact_export",
		label: "Export artifact",
		description:
			"Export an artifact as one self-contained HTML file. It works offline: the artifact's memory is snapshotted (then kept in localStorage) and MCP calls replay the results last fetched in the viewer.",
		promptSnippet: "Export an artifact to a single self-contained HTML file",
		parameters: Type.Object({
			id: Type.String({ description: "Artifact id" }),
			path: Type.Optional(Type.String({ description: "Output .html file; default <cwd>/<id>.html" })),
			overwrite: Type.Optional(Type.Boolean({ description: "Replace the file if it exists (only after the user agreed)" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			runtime.captureToolContext(ctx);
			const r = await runtime.daemon.api<ExportResponse>("/export", {
				id: params.id,
				outFile: exportTarget(ctx.cwd, params.id, params.path),
				overwrite: params.overwrite === true,
			});
			return { content: [{ type: "text", text: formatExport(r) }], details: r };
		},
		renderResult(result, { isPartial }, theme) {
			const d = result.details as ExportResponse | undefined;
			if (isPartial || !d) return new Text(theme.fg("warning", "bundling…"), 0, 0);
			return new Text(theme.fg("success", "✓ exported ") + theme.fg("accent", d.file) + theme.fg("dim", ` · ${(d.bytes / 1024).toFixed(0)} KB`), 0, 0);
		},
	});
}
