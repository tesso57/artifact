import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assertMemoryKey } from "../../shared/ids.ts";
import type { ArtifactsRuntime } from "../runtime.ts";

export function registerArtifactMemory(pi: ExtensionAPI, runtime: ArtifactsRuntime): void {
	pi.registerTool({
		name: "artifact_memory",
		label: "Artifact memory",
		description: 'Read or write the SQLite memory artifacts use via useMemory(). scope is an artifact id, "shared", or "template-<name>" for a template preview.',
		promptSnippet: "Read or write the persistent memory of artifacts",
		parameters: Type.Object({
			action: StringEnum(["list", "get", "set", "delete"] as const),
			scope: Type.String({ description: 'Artifact id, "shared", or "template-<name>" for a preview' }),
			key: Type.Optional(Type.String()),
			value: Type.Optional(Type.Unknown({ description: "Required JSON value for set; use delete to remove a key" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			runtime.captureToolContext(ctx);
			if (params.action === "set" && params.value === undefined) throw new Error('A value is required for set; use the "delete" action to remove a key');
			let out: unknown;
			if (params.action === "set") {
				let json: string | undefined;
				try { json = JSON.stringify(params.value); }
				catch (error) { throw new Error("Memory values must be JSON serializable", { cause: error }); }
				if (json === undefined) throw new Error("Memory values must be JSON serializable");
				out = await runtime.daemon.api("/memory", { ...params, value: JSON.parse(json) });
			} else if (params.action === "get") {
				assertMemoryKey(params.key);
				let result: { found: boolean; value?: unknown };
				try {
					result = await runtime.daemon.api("/memory", { ...params, action: "get-with-presence" });
				} catch (error) {
					if (!(error instanceof Error) || !error.message.includes('Unknown memory action "get-with-presence"')) throw error;
					const entries = await runtime.daemon.api<{ key: string; value: unknown }[]>("/memory", { action: "list", scope: params.scope });
					const entry = entries.find((item) => item.key === params.key);
					result = entry ? { found: true, value: entry.value } : { found: false };
				}
				if (!result.found) return { content: [{ type: "text", text: `No value found for key ${JSON.stringify(params.key)}.` }], details: undefined };
				out = result.value;
			} else out = await runtime.daemon.api("/memory", params);
			return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], details: undefined };
		},
	});
}
