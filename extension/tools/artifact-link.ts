import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assertArtifactId } from "../../shared/ids.ts";
import type { ArtifactMeta } from "../../shared/protocol.ts";
import type { ArtifactsRuntime } from "../runtime.ts";

/** Issue a fresh one-use link without changing the artifact. */
export function registerArtifactLink(pi: ExtensionAPI, runtime: ArtifactsRuntime): void {
	pi.registerTool({
		name: "artifact_link",
		label: "Link artifact",
		description: "Get a fresh, single-use Open link for an existing artifact without rewriting it. Links remain valid until used or the viewer restarts.",
		promptSnippet: "Get a fresh link to an existing artifact",
		parameters: Type.Object({ id: Type.String({ description: "Existing artifact id" }) }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			assertArtifactId(params.id);
			runtime.captureToolContext(ctx);
			await runtime.connect();
			// Older daemons ignore the filter and return the full list, so keep the lookup.
			const artifacts = await runtime.daemon.api<ArtifactMeta[]>(`/artifacts?id=${encodeURIComponent(params.id)}`);
			const artifact = artifacts.find((item) => item.id === params.id);
			if (!artifact) throw new Error(`No artifact "${params.id}"`);
			const link = await runtime.daemon.link(`/a/${artifact.id}`);
			return { content: [{ type: "text", text: `Open: ${link}\nSingle-use; valid until used or the viewer restarts.` }], details: { id: artifact.id, link } };
		},
	});
}
