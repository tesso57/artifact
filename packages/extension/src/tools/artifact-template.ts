import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	deleteTemplate,
	getTemplate,
	listTemplates,
	saveTemplate,
	writeArtifact,
} from "@pi-artifacts/core";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ArtifactsRuntime } from "../runtime.ts";
import { checkModule } from "../viewer.ts";

/** Templates shipped with the artifacts skill. */
const BUNDLED_TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../skills/artifacts/templates");

type Params = {
	action: "list" | "get" | "save" | "delete";
	name?: string;
	title?: string;
	description?: string;
	useCases?: string[];
	tags?: string[];
	code?: string;
	preview?: boolean;
};

function need<T>(value: T | undefined, field: string, action: string): T {
	if (value === undefined || value === "") throw new Error(`"${field}" is required for ${action}`);
	return value;
}

export function registerArtifactTemplate(pi: ExtensionAPI, runtime: ArtifactsRuntime): void {
	pi.registerTool({
		name: "artifact_template",
		label: "Artifact template",
		description:
			"List, read, save or delete artifact templates (reusable TSX starting points with use cases). save compile-checks the code and can open a preview.",
		promptSnippet: "List, read and save reusable artifact templates",
		promptGuidelines: [
			"Before writing a new artifact, call artifact_template with action list and start from the closest template (action get) instead of writing from scratch.",
		],
		parameters: Type.Object({
			action: StringEnum(["list", "get", "save", "delete"] as const),
			name: Type.Optional(Type.String({ description: "Template name (lowercase-slug)" })),
			title: Type.Optional(Type.String()),
			description: Type.Optional(Type.String({ description: "What the template shows/does" })),
			useCases: Type.Optional(Type.Array(Type.String(), { description: "Requests this template fits, for routing" })),
			tags: Type.Optional(Type.Array(Type.String())),
			code: Type.Optional(Type.String({ description: "Template TSX (same contract as artifact_write)" })),
			preview: Type.Optional(Type.Boolean({ description: "save: also write it as artifact template-<name> and return its URL" })),
		}),
		async execute(_toolCallId, raw, _signal, _onUpdate, ctx) {
			runtime.captureToolContext(ctx);
			const p = raw as Params;
			const text = (v: unknown) => ({
				content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }],
				details: undefined,
			});

			switch (p.action) {
				case "list": {
					const all = await listTemplates(BUNDLED_TEMPLATES_DIR);
					return text(all.map(({ name, title, description, useCases, tags, source }) => ({ name, title, description, useCases, tags, source })));
				}
				case "get": {
					const t = await getTemplate(need(p.name, "name", "get"), BUNDLED_TEMPLATES_DIR);
					if (!t) throw new Error(`No template "${p.name}"`);
					return text(`// template ${t.name} (${t.source}): ${t.title} — ${t.description}\n// use cases: ${t.useCases.join("; ")}\n${t.code}`);
				}
				case "delete":
					return text({ deleted: await deleteTemplate(need(p.name, "name", "delete")) });
				case "save": {
					const name = need(p.name, "name", "save");
					const code = need(p.code, "code", "save");
					const info = await saveTemplate(
						name,
						{ title: need(p.title, "title", "save"), description: need(p.description, "description", "save"), useCases: p.useCases ?? [], tags: p.tags },
						code,
					);
					const base = await runtime.ensureViewer();
					const compileError = await checkModule(base, `/@fs${info.path}`);
					const lines = [`Saved template "${name}" to ${info.path}`];
					if (compileError) {
						lines.push("", "Compile error — fix it and save again:", compileError);
						return { ...text(lines.join("\n")), isError: true };
					}
					if (p.preview) {
						const id = `template-${name}`;
						await writeArtifact({ id, title: `Template: ${info.title}`, description: info.description, code, cwd: ctx.cwd });
						lines.push(`Preview: ${base}/a/${id}`);
					}
					return text(lines.join("\n"));
				}
			}
		},
	});
}
