import { getMemory, type Memory } from "@pi-artifacts/core";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ArtifactsRuntime } from "../runtime.ts";

export type MemoryAction = "list" | "get" | "set" | "delete";

/** Run one artifact_memory action; pure so it can be tested against an in-memory db. */
export function runMemoryAction(
	mem: Memory,
	p: { action: MemoryAction; scope: string; key?: string; value?: unknown },
): unknown {
	const key = () => {
		if (!p.key) throw new Error(`"key" is required for ${p.action}`);
		return p.key;
	};
	switch (p.action) {
		case "list":
			return mem.list(p.scope).map((e) => ({ key: e.key, value: e.value }));
		case "get":
			return mem.get(p.scope, key()) ?? null;
		case "set":
			mem.set(p.scope, key(), p.value);
			return { ok: true };
		case "delete":
			return { deleted: mem.delete(p.scope, key()) };
	}
}

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
			// StringEnum's static type is not inferred through the host's TypeBox copy.
			const out = runMemoryAction(getMemory(), params as Parameters<typeof runMemoryAction>[1]);
			return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], details: undefined };
		},
	});
}
