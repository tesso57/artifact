import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { artifactsDir } from "../shared/paths.ts";
import type { ArtifactMeta } from "../shared/protocol.ts";
import { openInBrowser } from "./open.ts";
import { ViewerNotRunningError } from "./daemon-client.ts";
import type { ArtifactsRuntime } from "./runtime.ts";
import { type ExportResponse, exportTarget, formatExport } from "./tools/artifact-export.ts";

const GALLERY = "▸ Open gallery";

async function list(runtime: ArtifactsRuntime): Promise<ArtifactMeta[]> {
	return runtime.daemon.api<ArtifactMeta[]>("/artifacts");
}

/** Ask which artifact to open; `null` means the gallery, `undefined` means cancelled. */
async function pickArtifact(runtime: ArtifactsRuntime, ctx: ExtensionCommandContext): Promise<string | null | undefined> {
	const all = await list(runtime);
	const labels = [GALLERY, ...all.map((a) => `${a.title}  (${a.id})`)];
	const choice = await ctx.ui.select(`Artifacts — ${artifactsDir()}`, labels);
	if (!choice) return undefined;
	return choice === GALLERY ? null : (all[labels.indexOf(choice) - 1]?.id ?? undefined);
}

async function open(runtime: ArtifactsRuntime, ctx: ExtensionCommandContext, id: string | null) {
	await runtime.connect();
	if (id && !(await list(runtime)).some((a) => a.id === id)) return ctx.ui.notify(`No artifact "${id}"`, "error");
	const link = await runtime.daemon.link(id ? `/a/${id}` : "/");
	ctx.ui.notify(await openInBrowser(link) ? `Opened ${runtime.daemon.url}${id ? `/a/${id}` : ""}` : link, "info");
}

export function registerArtifactsCommand(pi: ExtensionAPI, runtime: ArtifactsRuntime): void {
	pi.registerCommand("artifacts", {
		description: "Open the gallery or an artifact (/artifacts [id | export <id> [file] | delete <id> | stop])",
		getArgumentCompletions: async (prefix) => {
			const items = [
				{ value: "export", label: "export", description: "Export an artifact as one HTML file" },
				{ value: "delete", label: "delete", description: "Delete an artifact" },
				{ value: "stop", label: "stop", description: "Stop the viewer (all pi sessions)" },
				...(await list(runtime).catch(() => [])).map((a) => ({ value: a.id, label: a.id, description: a.title })),
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length ? filtered : null;
		},
		handler: async (args, ctx) => {
			runtime.attach(ctx);
			const [, sub = "", arg, path] = /^(\S+)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/.exec(args.trim()) ?? [];
			try {
				if (sub === "stop") {
					try { await runtime.daemon.api("/shutdown", {}, { start: false }); }
					catch (error) {
						if (error instanceof ViewerNotRunningError) return ctx.ui.notify("Artifact viewer is not running", "info");
						throw error;
					}
					return ctx.ui.notify("Stopping artifact viewer", "info");
				}
				if (sub === "export") {
					if (!arg) return ctx.ui.notify("Usage: /artifacts export <id> [file.html]", "warning");
					ctx.ui.notify(`Exporting ${arg}…`, "info");
					const outFile = exportTarget(ctx.cwd, arg, path);
					let overwrite = false;
					if (existsSync(outFile)) {
						if (!(await ctx.ui.confirm("Overwrite?", `${outFile} exists. Replace it?`))) return ctx.ui.notify("Export cancelled", "info");
						overwrite = true;
					}
					const r = await runtime.daemon.api<ExportResponse>("/export", { id: arg, outFile, overwrite });
					return ctx.ui.notify(formatExport(r), "info");
				}
				if (sub === "delete") {
					if (!arg) return ctx.ui.notify("Usage: /artifacts delete <id>", "warning");
					if (!(await ctx.ui.confirm("Delete artifact", `Delete "${arg}", its files and its memory?`))) return;
					const { deleted } = await runtime.daemon.api<{ deleted: boolean }>("/artifacts/delete", { id: arg });
					return ctx.ui.notify(deleted ? `Deleted ${arg}` : `No artifact "${arg}"`, deleted ? "info" : "warning");
				}
				if (sub) return await open(runtime, ctx, sub);
				if (!ctx.hasUI) return await open(runtime, ctx, null);
				const picked = await pickArtifact(runtime, ctx);
				if (picked !== undefined) await open(runtime, ctx, picked);
			} catch (error) {
				ctx.ui.notify(`Artifacts: ${(error as Error).message}`, "error");
			}
		},
	});
}
