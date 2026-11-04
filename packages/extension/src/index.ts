/**
 * pi-artifacts — live React artifacts for pi.
 *
 * - `artifact_write` writes a TSX artifact and serves it from one shared
 *   TanStack Start (Vite) dev server with HMR, shadcn/ui and Tailwind.
 * - `artifact_memory` reads/writes the artifacts' SQLite memory.
 * - Artifacts call pi's MCP tools through a local, token-protected bridge.
 * - `/artifacts` lists and opens artifacts.
 */
import {
	artifactModuleUrl,
	artifactPaths,
	artifactsDir,
	deleteArtifact,
	getMemory,
	listArtifacts,
	readMeta,
	slugify,
	VIEWER_DIR,
	writeArtifact,
} from "@pi-artifacts/core";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type Bridge, startBridge, type ToolRunner } from "./bridge.ts";
import { openInBrowser } from "./open.ts";
import { ARTIFACT_GUIDELINES } from "./prompt.ts";
import { checkModule, Viewer } from "./viewer.ts";

interface WriteDetails {
	id: string;
	title: string;
	url?: string;
	path: string;
	created: boolean;
	compileError?: string;
	viewerError?: string;
}

export default function piArtifacts(pi: ExtensionAPI) {
	let bridge: Bridge | undefined;
	let viewer: Viewer | undefined;
	/** Tool context captured from the latest artifact tool call; the bridge runs MCP tools with it. */
	let runner: ToolRunner | undefined;
	let uiCtx: ExtensionContext | undefined;
	let mcpCalls = 0;

	const setStatus = () => {
		if (!uiCtx?.hasUI) return;
		const url = viewer?.url;
		uiCtx.ui.setStatus(
			"artifacts",
			url ? uiCtx.ui.theme.fg("accent", `◆ artifacts ${url}${mcpCalls ? ` · ${mcpCalls} mcp` : ""}`) : undefined,
		);
	};

	async function ensureViewer(): Promise<string> {
		bridge ??= await startBridge({
			getRunner: () => runner,
			listAllTools: () =>
				pi
					.getAllTools()
					.filter((t) => t.name.startsWith("mcp__"))
					.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
			onCall: () => {
				mcpCalls++;
				setStatus();
			},
		});
		viewer ??= new Viewer({
			port: Number(process.env.PI_ARTIFACTS_PORT) || 5178,
			env: { PI_ARTIFACTS_BRIDGE_URL: bridge.url, PI_ARTIFACTS_BRIDGE_TOKEN: bridge.token },
		});
		const url = await viewer.ensure();
		setStatus();
		return url;
	}

	async function shutdown() {
		viewer?.stop();
		viewer = undefined;
		await bridge?.close();
		bridge = undefined;
		runner = undefined;
		uiCtx?.hasUI && uiCtx.ui.setStatus("artifacts", undefined);
	}

	pi.on("session_start", async (_event, ctx) => {
		uiCtx = ctx;
	});
	pi.on("session_shutdown", async () => {
		await shutdown();
	});

	// -------------------------------------------------------------------------
	// artifact_write
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "artifact_write",
		label: "Artifact",
		description:
			"Create or replace a live React artifact (one TSX module, default-exported component) and serve it in the browser with hot reload. Returns the URL and any compile error.",
		promptSnippet: "Create or update a live, interactive React artifact viewable in the browser",
		promptGuidelines: ARTIFACT_GUIDELINES,
		parameters: Type.Object({
			title: Type.String({ description: "Short human-readable title" }),
			code: Type.String({ description: "Complete TSX module with `export default function …`" }),
			id: Type.Optional(
				Type.String({ description: "Existing artifact id to replace; omit to derive one from the title" }),
			),
			description: Type.Optional(Type.String({ description: "One sentence shown in the gallery" })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			runner = ctx as unknown as ToolRunner;
			uiCtx = ctx;
			const id = params.id ? params.id.trim() : slugify(params.title);
			const existed = !!(await readMeta(id));
			const meta = await writeArtifact({
				id,
				title: params.title,
				description: params.description,
				code: params.code,
				cwd: ctx.cwd,
			});
			const { entry } = artifactPaths(meta.id);
			const details: WriteDetails = { id: meta.id, title: meta.title, path: entry, created: !existed };
			onUpdate?.({ content: [{ type: "text", text: "Starting viewer…" }], details });

			try {
				const base = await ensureViewer();
				details.url = `${base}/a/${meta.id}`;
				details.compileError = await checkModule(base, artifactModuleUrl(meta.id, VIEWER_DIR));
			} catch (error) {
				details.viewerError = (error as Error).message;
			}

			const lines = [
				`${existed ? "Updated" : "Created"} artifact "${meta.title}" (id: ${meta.id})`,
				`File: ${entry}`,
				details.url ? `URL: ${details.url}` : `Viewer failed to start: ${details.viewerError}`,
			];
			if (details.compileError) lines.push("", "Compile error — fix it and write again:", details.compileError);
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details,
				isError: !!details.compileError || !!details.viewerError,
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const title = args.title ? ` ${args.title}` : "";
			const lines = typeof args.code === "string" ? args.code.split("\n").length : 0;
			text.setText(
				theme.fg("toolTitle", theme.bold("◆ artifact")) +
					theme.fg("accent", title) +
					(lines ? theme.fg("dim", ` · ${lines} lines`) : ""),
			);
			return text;
		},
		renderResult(result, { isPartial, expanded }, theme) {
			const d = result.details as WriteDetails | undefined;
			if (isPartial || !d) return new Text(theme.fg("warning", "starting viewer…"), 0, 0);
			let s = d.compileError
				? theme.fg("error", `✗ compile error in ${d.id}`)
				: d.viewerError
					? theme.fg("error", `✗ viewer: ${d.viewerError.split("\n")[0]}`)
					: theme.fg("success", `✓ ${d.created ? "created" : "updated"} `) + theme.fg("accent", d.url ?? d.id);
			if (d.compileError && expanded) s += `\n${theme.fg("dim", d.compileError)}`;
			if (expanded) s += `\n${theme.fg("dim", d.path)}`;
			return new Text(s, 0, 0);
		},
	});

	// -------------------------------------------------------------------------
	// artifact_memory
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "artifact_memory",
		label: "Artifact memory",
		description:
			'Read or write the SQLite memory artifacts use via useMemory(). scope is an artifact id or "shared".',
		promptSnippet: "Read or write the persistent memory of artifacts",
		parameters: Type.Object({
			action: StringEnum(["list", "get", "set", "delete"] as const),
			scope: Type.String({ description: 'Artifact id, or "shared"' }),
			key: Type.Optional(Type.String()),
			value: Type.Optional(Type.Unknown({ description: "JSON value for set" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			runner = ctx as unknown as ToolRunner;
			const mem = getMemory();
			const needKey = () => {
				if (!params.key) throw new Error(`"key" is required for ${params.action}`);
				return params.key;
			};
			let out: unknown;
			switch (params.action) {
				case "list":
					out = mem.list(params.scope).map((e) => ({ key: e.key, value: e.value }));
					break;
				case "get":
					out = mem.get(params.scope, needKey()) ?? null;
					break;
				case "set":
					mem.set(params.scope, needKey(), params.value);
					out = { ok: true };
					break;
				case "delete":
					out = { deleted: mem.delete(params.scope, needKey()) };
					break;
			}
			return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], details: undefined };
		},
	});

	// -------------------------------------------------------------------------
	// /artifacts
	// -------------------------------------------------------------------------
	pi.registerCommand("artifacts", {
		description: "Open the artifact gallery or an artifact (/artifacts [id|stop|delete <id>])",
		getArgumentCompletions: async (prefix) => {
			const items = [
				{ value: "stop", label: "stop", description: "Stop the viewer" },
				...(await listArtifacts()).map((a) => ({ value: a.id, label: a.id, description: a.title })),
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length ? filtered : null;
		},
		handler: async (args, ctx) => {
			uiCtx = ctx;
			const [sub, arg] = args.trim().split(/\s+/);
			if (sub === "stop") {
				await shutdown();
				ctx.ui.notify("Artifact viewer stopped", "info");
				return;
			}
			if (sub === "delete" && arg) {
				const ok = (await ctx.ui.confirm("Delete artifact", `Delete "${arg}" and its files?`)) && (await deleteArtifact(arg));
				ctx.ui.notify(ok ? `Deleted ${arg}` : "Nothing deleted", ok ? "info" : "warning");
				return;
			}

			let id = sub || undefined;
			if (!id && ctx.hasUI) {
				const all = await listArtifacts();
				const GALLERY = "▸ Open gallery";
				const labels = [GALLERY, ...all.map((a) => `${a.title}  (${a.id})`)];
				const choice = await ctx.ui.select(`Artifacts — ${artifactsDir()}`, labels);
				if (!choice) return;
				id = choice === GALLERY ? undefined : all[labels.indexOf(choice) - 1]?.id;
			}
			if (id && !(await readMeta(id))) {
				ctx.ui.notify(`No artifact "${id}"`, "error");
				return;
			}

			try {
				const base = await ensureViewer();
				const url = id ? `${base}/a/${id}` : base;
				const opened = openInBrowser(url);
				ctx.ui.notify(opened ? `Opened ${url}` : url, "info");
			} catch (error) {
				ctx.ui.notify(`Viewer failed: ${(error as Error).message}`, "error");
			}
		},
	});
}
