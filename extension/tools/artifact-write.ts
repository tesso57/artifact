import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ArtifactMeta, RuntimeError } from "../../shared/protocol.ts";
import { ARTIFACT_GUIDELINES } from "../prompt.ts";
import type { ArtifactsRuntime } from "../runtime.ts";

interface WriteResponse {
	meta: ArtifactMeta;
	created: boolean;
	path: string;
	url: string;
	link: string;
	compileError?: string;
	runtimeErrors: RuntimeError[];
	observed: boolean;
}

interface WriteDetails {
	id: string;
	title: string;
	path?: string;
	link?: string;
	created?: boolean;
	compileError?: string;
	runtimeErrors?: RuntimeError[];
	viewerError?: string;
}

export function formatWriteResult(r: WriteResponse): string {
	const lines = [
		`${r.created ? "Created" : "Updated"} artifact "${r.meta.title}" (id: ${r.meta.id})`,
		`File: ${r.path}`,
		`Open: ${r.link}`,
		`MCP allowlist: ${r.meta.mcp?.length ? r.meta.mcp.join(", ") : "none"}`,
	];
	if (r.compileError) {
		lines.push("", "Compile error — fix it and write again:", r.compileError);
	} else if (r.runtimeErrors.length) {
		lines.push("", "The open browser tab reported runtime errors — fix them and write again:");
		for (const e of r.runtimeErrors) lines.push(`- ${e.message}${e.stack ? `\n  ${e.stack.split("\n").slice(1, 4).join("\n  ")}` : ""}`);
	} else if (!r.observed) {
		lines.push("", "No browser tab had it open, so runtime errors were not checked.");
	}
	return lines.join("\n");
}

export function registerArtifactWrite(pi: ExtensionAPI, runtime: ArtifactsRuntime): void {
	pi.registerTool({
		name: "artifact_write",
		label: "Artifact",
		description:
			"Create or replace a live React artifact (one TSX module with a default-exported component) served in the browser with hot reload. Returns an open link, the file path, and compile or runtime errors.",
		promptSnippet: "Create or update a live, interactive React artifact viewable in the browser",
		promptGuidelines: ARTIFACT_GUIDELINES,
		parameters: Type.Object({
			title: Type.String({ description: "Short human-readable title" }),
			code: Type.String({ description: "Complete TSX module with `export default function …`" }),
			id: Type.Optional(Type.String({ description: "Id of an existing artifact to replace; omit to create a new one" })),
			description: Type.Optional(Type.String({ description: "One sentence shown in the gallery" })),
			mcp: Type.Optional(
				Type.Array(Type.String(), {
					description: 'MCP tools the artifact may call: "server.tool", "server.*" or "*". Calls outside this list fail.',
				}),
			),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			runtime.captureToolContext(ctx);
			onUpdate?.({ content: [{ type: "text", text: "Starting viewer…" }], details: { id: params.id ?? "", title: params.title } });
			let r: WriteResponse;
			try {
				await runtime.connect();
				r = await runtime.daemon.api<WriteResponse>("/artifacts/write", {
					id: params.id?.trim() || undefined,
					title: params.title,
					description: params.description,
					code: params.code,
					cwd: ctx.cwd,
					sessionId: runtime.id,
					mcp: params.mcp,
				});
			} catch (error) {
				const details: WriteDetails = { id: params.id ?? "", title: params.title, viewerError: (error as Error).message };
				return { content: [{ type: "text", text: `Viewer error: ${details.viewerError}` }], details, isError: true };
			}
			const details: WriteDetails = {
				id: r.meta.id,
				title: r.meta.title,
				path: r.path,
				link: r.link,
				created: r.created,
				compileError: r.compileError,
				runtimeErrors: r.runtimeErrors,
			};
			return {
				content: [{ type: "text", text: formatWriteResult(r) }],
				details,
				isError: !!r.compileError || r.runtimeErrors.length > 0,
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const title = args.title ? ` ${args.title}` : "";
			const lines = typeof args.code === "string" ? args.code.split("\n").length : 0;
			text.setText(
				theme.fg("toolTitle", theme.bold("◆ artifact")) + theme.fg("accent", title) + (lines ? theme.fg("dim", ` · ${lines} lines`) : ""),
			);
			return text;
		},
		renderResult(result, { isPartial, expanded }, theme) {
			const d = result.details as WriteDetails | undefined;
			if (isPartial || !d) return new Text(theme.fg("warning", "starting viewer…"), 0, 0);
			let s = d.viewerError
				? theme.fg("error", `✗ viewer: ${d.viewerError.split("\n")[0]}`)
				: d.compileError
					? theme.fg("error", `✗ compile error in ${d.id}`)
					: d.runtimeErrors?.length
						? theme.fg("error", `✗ ${d.runtimeErrors.length} runtime error(s) in ${d.id}`)
						: theme.fg("success", `✓ ${d.created ? "created" : "updated"} `) + theme.fg("accent", d.id);
			if (d.link && !d.viewerError) s += `\n${theme.fg("dim", d.link)}`;
			if (expanded) {
				if (d.compileError) s += `\n${theme.fg("dim", d.compileError)}`;
				for (const e of d.runtimeErrors ?? []) s += `\n${theme.fg("dim", e.message)}`;
				if (d.path) s += `\n${theme.fg("dim", d.path)}`;
			}
			return new Text(s, 0, 0);
		},
	});
}
