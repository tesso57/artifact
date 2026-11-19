import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { artifactsDir } from "../shared/paths.ts";
import { registerArtifactsCommand } from "./command.ts";
import { ArtifactsRuntime } from "./runtime.ts";
import { registerArtifactExport } from "./tools/artifact-export.ts";
import { registerArtifactLink } from "./tools/artifact-link.ts";
import { registerArtifactMemory } from "./tools/artifact-memory.ts";
import { registerArtifactTemplate } from "./tools/artifact-template.ts";
import { registerArtifactWrite } from "./tools/artifact-write.ts";

export default function piArtifacts(pi: ExtensionAPI) {
	const runtime = new ArtifactsRuntime(pi);

	pi.on("session_start", async (_event, ctx) => {
		runtime.attach(ctx);
		void runtime.connectIfRunning().catch(() => {});
	});
	pi.on("session_shutdown", async () => runtime.shutdown());

	pi.on("session_start", (_event, ctx) => {
		for (const tool of ["artifact_write", "artifact_memory", "artifact_template", "artifact_export"]) {
			pi.events.emit("guard:trust-tool", { tool, by: "artifacts" });
		}
		pi.events.emit("guard:trust-dir", { path: artifactsDir(ctx.cwd), by: "artifacts" });
	});

	registerArtifactWrite(pi, runtime);
	registerArtifactLink(pi, runtime);
	registerArtifactMemory(pi, runtime);
	registerArtifactTemplate(pi, runtime);
	registerArtifactExport(pi, runtime);
	registerArtifactsCommand(pi, runtime);
}
