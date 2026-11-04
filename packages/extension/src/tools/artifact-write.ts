import { artifactModuleUrl, artifactPaths, readMeta, slugify, writeArtifact } from "@pi-artifacts/core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { ARTIFACT_GUIDELINES } from "../prompt.ts";
import type { ArtifactsRuntime } from "../runtime.ts";
import { checkModule } from "../viewer.ts";

interface WriteDetails {
	id: string;
	title: string;
	url?: string;
	path: string;
	created: boolean;
	compileError?: string;
	viewerError?: string;
}

export function formatWriteResult(d: WriteDetails): string {
	const lines = [
		`${d.created ? "Created" : "Updated"} artifact "${d.title}" (id: ${d.id})`,
		`File: ${d.path}`,
		d.url ? `URL: ${d.url}` : `Viewer failed to start: ${d.viewerError}`,
	];
	if (d.compileError) lines.push("", "Compile error — fix it and write again:", d.compileError);
	return lines.join("\n");
}

export function registerArtifactWrite(pi: ExtensionAPI, runtime: ArtifactsRuntime): void {
	pi.registerTool({
		name: "artifact_write",
		label: "Artifact",
		description:
			"Create or replace a live React artifact (one TSX module, default-exported component) and serve it in the browser with hot reload. Returns the URL and any compile error.",
		promptSnippet: "Create or update a live, interactive React artifact viewable in the browser",
		promptGuidelines: ARTIFACT_GUIDELINES,
		parameters: Type.Object({
			title: Type.String({ description: "Short human-readable title" }),
			code: Type.String({ description: "Complete TSX module with `export default function …`" }),
			id: Type.Optional(
				Type.String({ description: "Existing artifact id to replace; omit to derive one from the title" }),
			),
			description: Type.Optional(Type.String({ description: "One sentence shown in the gallery" })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			runtime.captureToolContext(ctx);
			const id = params.id?.trim() || slugify(params.title);
			const created = !(await readMeta(id));
			const meta = await writeArtifact({
				id,
				title: params.title,
				description: params.description,
				code: params.code,
				cwd: ctx.cwd,
			});
			const details: WriteDetails = { id: meta.id, title: meta.title, path: artifactPaths(meta.id).entry, created };
			onUpdate?.({ content: [{ type: "text", text: "Starting viewer…" }], details });

			try {
				const base = await runtime.ensureViewer();
				details.url = `${base}/a/${meta.id}`;
				details.compileError = await checkModule(base, artifactModuleUrl(meta.id, runtime.viewerDir));
			} catch (error) {
				details.viewerError = (error as Error).message;
			}

			return {
				content: [{ type: "text", text: formatWriteResult(details) }],
				details,
				isError: !!details.compileError || !!details.viewerError,
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const title = args.title ? ` ${args.title}` : "";
			const lines = typeof args.code === "string" ? args.code.split("\n").length : 0;
			text.setText(
				theme.fg("toolTitle", theme.bold("◆ artifact")) +
					theme.fg("accent", title) +
					(lines ? theme.fg("dim", ` · ${lines} lines`) : ""),
			);
			return text;
		},
		renderResult(result, { isPartial, expanded }, theme) {
			const d = result.details as WriteDetails | undefined;
			if (isPartial || !d) return new Text(theme.fg("warning", "starting viewer…"), 0, 0);
			let s = d.compileError
				? theme.fg("error", `✗ compile error in ${d.id}`)
				: d.viewerError
					? theme.fg("error", `✗ viewer: ${d.viewerError.split("\n")[0]}`)
					: theme.fg("success", `✓ ${d.created ? "created" : "updated"} `) + theme.fg("accent", d.url ?? d.id);
			if (expanded) {
				if (d.compileError) s += `\n${theme.fg("dim", d.compileError)}`;
				s += `\n${theme.fg("dim", d.path)}`;
			}
			return new Text(s, 0, 0);
		},
	});
}
