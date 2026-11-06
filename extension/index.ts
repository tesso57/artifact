/**
 * pi-artifacts — live React artifacts for pi.
 *
 * A per-user viewer daemon (TanStack Start on Vite) serves every artifact with hot reload
 * and owns their SQLite memory. This extension is its client:
 * - `artifact_write` writes an artifact and reports compile/runtime errors
 * - `artifact_memory` reads/writes artifact memory
 * - `artifact_template` lists, reads and saves reusable templates
 * - `artifact_export` bundles an artifact into one self-contained HTML file
 * - `/artifacts` opens, exports and deletes artifacts
 * - a loopback bridge lets artifacts call this session's MCP tools (allowlisted, approved)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { artifactsDir } from "../shared/paths.ts";
import { registerArtifactsCommand } from "./command.ts";
import { ArtifactsRuntime } from "./runtime.ts";
import { registerArtifactExport } from "./tools/artifact-export.ts";
import { registerArtifactMemory } from "./tools/artifact-memory.ts";
import { registerArtifactTemplate } from "./tools/artifact-template.ts";
import { registerArtifactWrite } from "./tools/artifact-write.ts";

export default function piArtifacts(pi: ExtensionAPI) {
	const runtime = new ArtifactsRuntime(pi);

	pi.on("session_start", async (_event, ctx) => {
		runtime.attach(ctx);
		// Join a viewer that is already running (so open artifacts can reach this session's
		// MCP servers); a viewer is only started when an artifact tool or /artifacts needs it.
		void runtime.connectIfRunning().catch(() => {});
	});
	pi.on("session_shutdown", async () => runtime.shutdown());

	// Tell a permission guard (if one listens) that this package's own tools are trusted, and
	// that its artifacts folder (~/.pi/artifacts, or PI_ARTIFACTS_DIR) may be edited, so
	// follow-up edits to an artifact's index.tsx are not blocked.
	pi.on("session_start", () => {
		for (const tool of ["artifact_write", "artifact_memory", "artifact_template", "artifact_export"]) {
			pi.events.emit("guard:trust-tool", { tool, by: "artifacts" });
		}
		pi.events.emit("guard:trust-dir", { path: artifactsDir(), by: "artifacts" });
	});

	registerArtifactWrite(pi, runtime);
	registerArtifactMemory(pi, runtime);
	registerArtifactTemplate(pi, runtime);
	registerArtifactExport(pi, runtime);
	registerArtifactsCommand(pi, runtime);
}
