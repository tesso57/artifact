import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ArtifactsRuntime } from "../runtime.ts";

type Params = {
	action: "list" | "get" | "save" | "delete";
	name?: string;
	title?: string;
	description?: string;
	useCases?: string[];
	tags?: string[];
	mcp?: string[];
	code?: string;
};

function need<T>(value: T | undefined, field: string, action: string): T {
	if (value === undefined || value === "") throw new Error(`"${field}" is required for ${action}`);
	return value;
}

const text = (v: unknown) => ({
	content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }],
	details: undefined,
});

export function registerArtifactTemplate(pi: ExtensionAPI, runtime: ArtifactsRuntime): void {
	pi.registerTool({
		name: "artifact_template",
		label: "Artifact template",
		description:
			"List, read, save or delete artifact templates (reusable TSX starting points with use cases). save compile-checks the code and returns a preview link. Deleting a user template also removes its preview memory and cached MCP results.",
		promptSnippet: "List, read and save reusable artifact templates",
		parameters: Type.Object({
			action: StringEnum(["list", "get", "save", "delete"] as const),
			name: Type.Optional(Type.String({ description: "Template name (lowercase slug)" })),
			title: Type.Optional(Type.String()),
			description: Type.Optional(Type.String({ description: "What the template shows/does" })),
			useCases: Type.Optional(Type.Array(Type.String(), { description: "Requests this template fits, for routing" })),
			tags: Type.Optional(Type.Array(Type.String())),
			mcp: Type.Optional(Type.Array(Type.String(), { description: "MCP tools its preview may call (as in artifact_write)" })),
			code: Type.Optional(Type.String({ description: "Template TSX (same contract as artifact_write)" })),
		}),
		async execute(_toolCallId, raw, _signal, _onUpdate, ctx) {
			runtime.captureToolContext(ctx);
			const p = raw as Params;
			switch (p.action) {
				case "list":
					return text(await runtime.daemon.api("/templates"));
				case "get": {
					const t = await runtime.daemon.api<{ name: string; source: string; title: string; description: string; useCases: string[]; mcp?: string[]; code: string }>(
						`/templates/get?name=${encodeURIComponent(need(p.name, "name", "get"))}`,
					);
					const header = [`// template ${t.name} (${t.source}): ${t.title} — ${t.description}`, `// use cases: ${t.useCases.join("; ")}`];
					if (t.mcp?.length) header.push(`// mcp: ${t.mcp.join(", ")}`);
					return text(`${header.join("\n")}\n${t.code}`);
				}
				case "delete":
					return text(await runtime.daemon.api("/templates/delete", { name: need(p.name, "name", "delete") }));
				case "save": {
					await runtime.connect();
					const r = await runtime.daemon.api<{ info: { path: string }; compileError?: string; previewLink?: string }>("/templates/save", {
						name: need(p.name, "name", "save"),
						title: need(p.title, "title", "save"),
						description: need(p.description, "description", "save"),
						useCases: p.useCases ?? [],
						tags: p.tags,
						mcp: p.mcp,
						code: need(p.code, "code", "save"),
					});
					const lines = [`Saved template "${p.name}" to ${r.info.path}`];
					if (r.compileError) return { ...text([...lines, "", "Compile error — fix it and save again:", r.compileError].join("\n")), isError: true };
					lines.push(`Preview: ${r.previewLink}`);
					return text(lines.join("\n"));
				}
			}
		},
	});
}
