import { VIEWER_DIR } from "@pi-artifacts/core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Bridge, startBridge, type ToolRunner } from "./bridge.ts";
import { Viewer } from "./viewer.ts";

/**
 * Session-scoped state of the extension: the viewer process, the MCP bridge, the tool
 * context MCP calls run with, and the footer status.
 */
export class ArtifactsRuntime {
	private bridge: Bridge | undefined;
	private viewer: Viewer | undefined;
	private runner: ToolRunner | undefined;
	private ui: ExtensionContext | undefined;
	private mcpCalls = 0;

	constructor(private readonly pi: ExtensionAPI) {}

	/** Remember the UI context for status updates (session start, commands, tools). */
	attach(ctx: ExtensionContext): void {
		this.ui = ctx;
	}

	/**
	 * Keep the context of a running tool call. Its `executeTool` stays usable after the call
	 * returns and runs MCP tools through pi's pipeline (hooks, permission gates).
	 */
	captureToolContext(ctx: ExtensionContext): void {
		this.attach(ctx);
		const candidate = ctx as Partial<ToolRunner>;
		if (typeof candidate.executeTool === "function") this.runner = candidate as ToolRunner;
	}

	get viewerUrl(): string | undefined {
		return this.viewer?.url;
	}

	get viewerDir(): string {
		return VIEWER_DIR;
	}

	/** Start the bridge and the viewer once; return the viewer's base URL. */
	async ensureViewer(): Promise<string> {
		this.bridge ??= await startBridge({
			getRunner: () => this.runner,
			listAllTools: () =>
				this.pi
					.getAllTools()
					.filter((t) => t.name.startsWith("mcp__"))
					.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
			onCall: () => {
				this.mcpCalls++;
				this.updateStatus();
			},
		});
		this.viewer ??= new Viewer({
			port: Number(process.env.PI_ARTIFACTS_PORT) || 5178,
			env: { PI_ARTIFACTS_BRIDGE_URL: this.bridge.url, PI_ARTIFACTS_BRIDGE_TOKEN: this.bridge.token },
		});
		const url = await this.viewer.ensure();
		this.updateStatus();
		return url;
	}

	async shutdown(): Promise<void> {
		this.viewer?.stop();
		this.viewer = undefined;
		await this.bridge?.close();
		this.bridge = undefined;
		this.runner = undefined;
		this.mcpCalls = 0;
		this.updateStatus();
	}

	private updateStatus(): void {
		const ui = this.ui;
		if (!ui?.hasUI) return;
		const url = this.viewer?.url;
		const calls = this.mcpCalls ? ` · ${this.mcpCalls} mcp` : "";
		ui.ui.setStatus("artifacts", url ? ui.ui.theme.fg("accent", `◆ artifacts ${url}${calls}`) : undefined);
	}
}
