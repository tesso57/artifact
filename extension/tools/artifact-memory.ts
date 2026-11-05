import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ArtifactsRuntime } from "../runtime.ts";

export function registerArtifactMemory(pi: ExtensionAPI, runtime: ArtifactsRuntime): void {
	pi.registerTool({
		name: "artifact_memory",
		label: "Artifact memory",
		description: 'Read or write the SQLite memory artifacts use via useMemory(). scope is an artifact id or "shared".',
		promptSnippet: "Read or write the persistent memory of artifacts",
		parameters: Type.Object({
			action: StringEnum(["list", "get", "set", "delete"] as const),
			scope: Type.String({ description: 'Artifact id, or "shared"' }),
			key: Type.Optional(Type.String()),
			value: Type.Optional(Type.Unknown({ description: "JSON value for set" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			runtime.captureToolContext(ctx);
			const out = await runtime.daemon.api("/memory", params);
			return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], details: undefined };
		},
	});
}
