import { artifactsDir, deleteArtifact, listArtifacts, readMeta } from "@pi-artifacts/core";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { openInBrowser } from "./open.ts";
import type { ArtifactsRuntime } from "./runtime.ts";

const GALLERY = "▸ Open gallery";

/** Ask which artifact to open; `null` means the gallery, `undefined` means cancelled. */
async function pickArtifact(ctx: ExtensionCommandContext): Promise<string | null | undefined> {
	const all = await listArtifacts();
	const labels = [GALLERY, ...all.map((a) => `${a.title}  (${a.id})`)];
	const choice = await ctx.ui.select(`Artifacts — ${artifactsDir()}`, labels);
	if (!choice) return undefined;
	return choice === GALLERY ? null : (all[labels.indexOf(choice) - 1]?.id ?? undefined);
}

async function open(runtime: ArtifactsRuntime, ctx: ExtensionCommandContext, id: string | null) {
	if (id && !(await readMeta(id))) return ctx.ui.notify(`No artifact "${id}"`, "error");
	try {
		const base = await runtime.ensureViewer();
		const url = id ? `${base}/a/${id}` : base;
		ctx.ui.notify(openInBrowser(url) ? `Opened ${url}` : url, "info");
	} catch (error) {
		ctx.ui.notify(`Viewer failed: ${(error as Error).message}`, "error");
	}
}

export function registerArtifactsCommand(pi: ExtensionAPI, runtime: ArtifactsRuntime): void {
	pi.registerCommand("artifacts", {
		description: "Open the artifact gallery or an artifact (/artifacts [id|stop|delete <id>])",
		getArgumentCompletions: async (prefix) => {
			const items = [
				{ value: "stop", label: "stop", description: "Stop the viewer" },
				{ value: "delete", label: "delete", description: "Delete an artifact" },
				...(await listArtifacts()).map((a) => ({ value: a.id, label: a.id, description: a.title })),
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length ? filtered : null;
		},
		handler: async (args, ctx) => {
			runtime.attach(ctx);
			const [sub, arg] = args.trim().split(/\s+/);

			if (sub === "stop") {
				await runtime.shutdown();
				return ctx.ui.notify("Artifact viewer stopped", "info");
			}
			if (sub === "delete") {
				if (!arg) return ctx.ui.notify("Usage: /artifacts delete <id>", "warning");
				const ok =
					(await ctx.ui.confirm("Delete artifact", `Delete "${arg}" and its files?`)) && (await deleteArtifact(arg));
				return ctx.ui.notify(ok ? `Deleted ${arg}` : "Nothing deleted", ok ? "info" : "warning");
			}
			if (sub) return open(runtime, ctx, sub);
			if (!ctx.hasUI) return open(runtime, ctx, null);
			const picked = await pickArtifact(ctx);
			if (picked !== undefined) await open(runtime, ctx, picked);
		},
	});
}
