import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BridgeCallRequest } from "../shared/protocol.ts";
import { type Bridge, startBridge, type ToolRunner } from "./bridge.ts";
import { DaemonClient } from "./daemon-client.ts";

const HEARTBEAT_MS = 30_000;

/**
 * Per-session state: this session's MCP bridge and its registration with the shared viewer
 * daemon. The daemon outlives sessions (it serves every pi session of the user and stops
 * itself when idle), so `session_shutdown` only unregisters.
 */
export class ArtifactsRuntime {
	readonly daemon = new DaemonClient();
	private bridge: Bridge | undefined;
	private runner: ToolRunner | undefined;
	private ui: ExtensionContext | undefined;
	private sessionId: string = randomUUID();
	private heartbeat: ReturnType<typeof setInterval> | undefined;
	private registered: Promise<void> | undefined;
	private mcpCalls = 0;

	private readonly pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	get id(): string {
		return this.sessionId;
	}

	/** Remember the UI context for status updates and approvals. */
	attach(ctx: ExtensionContext): void {
		this.ui = ctx;
		try {
			this.sessionId = ctx.sessionManager.getSessionId() || this.sessionId;
		} catch {}
	}

	/**
	 * Keep the context of a running tool call. Its `executeTool` stays usable after the call
	 * returns and runs MCP tools through pi's pipeline (hooks, permission gates). Cleared on
	 * session shutdown.
	 */
	captureToolContext(ctx: ExtensionContext): void {
		this.attach(ctx);
		const candidate = ctx as Partial<ToolRunner>;
		if (typeof candidate.executeTool === "function") this.runner = candidate as ToolRunner;
	}

	/** Register with a daemon that is already running; never starts one (cheap, for session start). */
	async connectIfRunning(): Promise<void> {
		if (await this.daemon.running()) await this.connect();
	}

	/** Start the daemon if needed, start the bridge and register this session (idempotent). */
	connect(): Promise<void> {
		this.registered ??= this.register().catch((error) => {
			this.registered = undefined;
			throw error;
		});
		return this.registered;
	}

	private async register(): Promise<void> {
		this.bridge ??= await startBridge({
			getRunner: () => this.runner,
			listAllTools: () =>
				this.pi.getAllTools().map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, annotations: t.annotations })),
			confirm: (req) => this.confirm(req),
			onCall: () => {
				this.mcpCalls++;
				this.updateStatus();
			},
		});
		const send = () =>
			this.daemon.api("/sessions/register", {
				sessionId: this.sessionId,
				cwd: this.ui?.cwd ?? process.cwd(),
				bridgeUrl: this.bridge!.url,
				bridgeToken: this.bridge!.token,
			});
		await send();
		clearInterval(this.heartbeat);
		this.heartbeat = setInterval(() => void send().catch(() => {}), HEARTBEAT_MS);
		this.heartbeat.unref?.();
		this.updateStatus();
	}

	private async confirm(req: BridgeCallRequest): Promise<boolean> {
		// PI_ARTIFACTS_MCP_APPROVAL: "allow" (headless setups), "deny", or ask (default).
		const policy = process.env.PI_ARTIFACTS_MCP_APPROVAL;
		if (policy === "allow") return true;
		if (policy === "deny") return false;
		const ui = this.ui;
		// Without a UI nobody can approve; read-only tools never get here.
		if (!ui?.hasUI) return false;
		return ui.ui.confirm(
			"Artifact wants to run an MCP tool",
			`"${req.artifactTitle}" wants to call ${req.name} with\n${JSON.stringify(req.args, null, 2).slice(0, 800)}\n\nAllow it for this artifact (until pi restarts)?`,
		);
	}

	async shutdown(): Promise<void> {
		clearInterval(this.heartbeat);
		this.heartbeat = undefined;
		if (this.registered) await this.daemon.api("/sessions/unregister", { sessionId: this.sessionId }, false).catch(() => {});
		this.registered = undefined;
		await this.bridge?.close();
		this.bridge = undefined;
		this.runner = undefined;
		this.mcpCalls = 0;
		this.updateStatus(true);
	}

	private updateStatus(clear = false): void {
		const ui = this.ui;
		if (!ui?.hasUI) return;
		const url = clear ? undefined : this.daemon.url;
		const calls = this.mcpCalls ? ` · ${this.mcpCalls} mcp` : "";
		ui.ui.setStatus("artifacts", url ? ui.ui.theme.fg("accent", `◆ artifacts ${url}${calls}`) : undefined);
	}
}
