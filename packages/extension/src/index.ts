/**
 * pi-artifacts — live React artifacts for pi.
 *
 * - `artifact_write` writes a TSX artifact and serves it from one shared TanStack Start
 *   (Vite) dev server with HMR, shadcn/ui and Tailwind.
 * - `artifact_memory` reads/writes the artifacts' SQLite memory.
 * - `artifact_template` lists, reads and saves reusable templates.
 * - `artifact_export` bundles an artifact into one self-contained HTML file.
 * - Artifacts call pi's MCP tools through a local, token-protected bridge.
 * - `/artifacts` lists and opens artifacts.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerArtifactsCommand } from "./command.ts";
import { ArtifactsRuntime } from "./runtime.ts";
import { registerArtifactExport } from "./tools/artifact-export.ts";
import { registerArtifactMemory } from "./tools/artifact-memory.ts";
import { registerArtifactTemplate } from "./tools/artifact-template.ts";
import { registerArtifactWrite } from "./tools/artifact-write.ts";

export default function piArtifacts(pi: ExtensionAPI) {
	const runtime = new ArtifactsRuntime(pi);

	pi.on("session_start", async (_event, ctx) => runtime.attach(ctx));
	pi.on("session_shutdown", async () => runtime.shutdown());

	registerArtifactWrite(pi, runtime);
	registerArtifactMemory(pi, runtime);
	registerArtifactExport(pi, runtime);
	registerArtifactTemplate(pi, runtime);
	registerArtifactsCommand(pi, runtime);
}
