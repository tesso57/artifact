import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BridgeCallRequest } from "../shared/protocol.ts";
import { type Bridge, startBridge, type ToolRunner } from "./bridge.ts";
import { DaemonClient } from "./daemon-client.ts";

const HEARTBEAT_MS = 30_000;
const REGISTRATION_TIMEOUT_MS = 5_000;

export class ArtifactsRuntime {
	readonly daemon = new DaemonClient();
	private bridge: Bridge | undefined;
	private runner: ToolRunner | undefined;
	private ui: ExtensionContext | undefined;
	private sessionId: string = randomUUID();
	private heartbeat: ReturnType<typeof setInterval> | undefined;
	private registered: Promise<void> | undefined;
	private readonly registrationRequests = new Set<Promise<unknown>>();
	private generation = 0;
	private registrationAbort = new AbortController();
	private mcpCalls = 0;

	private readonly pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
		this.daemon.onStarted = () => {
			if (this.bridge) void this.sendRegistration(false).catch(() => {});
		};
	}

	get id(): string {
		return this.sessionId;
	}

	attach(ctx: ExtensionContext): void {
		this.daemon.setProject(ctx.cwd);
		this.ui = ctx;
		try {
			this.sessionId = ctx.sessionManager.getSessionId() || this.sessionId;
		} catch {}
	}

	captureToolContext(ctx: ExtensionContext): void {
		this.attach(ctx);
		const candidate = ctx as Partial<ToolRunner>;
		if (typeof candidate.executeTool !== "function") return;
		const first = !this.runner;
		this.runner = candidate as ToolRunner;
		if (first && this.registered) void this.sendRegistration(false).catch(() => {});
	}

	private registration() {
		return {
			sessionId: this.sessionId,
			cwd: this.ui?.cwd ?? process.cwd(),
			bridgeUrl: this.bridge!.url,
			bridgeToken: this.bridge!.token,
			ready: !!this.runner,
			tools: this.pi.getAllTools().map((t) => t.name).filter((n) => n.startsWith("mcp__")),
		};
	}

	private sendRegistration(start: boolean) {
		const request = this.daemon.api("/sessions/register", this.registration(), { start, timeoutMs: REGISTRATION_TIMEOUT_MS, beforeSendSignal: this.registrationAbort.signal });
		this.registrationRequests.add(request);
		void request.then(() => this.registrationRequests.delete(request), () => this.registrationRequests.delete(request));
		return request;
	}

	async connectIfRunning(): Promise<void> {
		const generation = this.generation;
		if (await this.daemon.running() && generation === this.generation) await this.connect(false);
	}

	connect(start = true): Promise<void> {
		this.registered ??= this.register(start).catch((error) => {
			this.registered = undefined;
			throw error;
		});
		return this.registered;
	}

	private async register(start: boolean): Promise<void> {
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
		await this.sendRegistration(start);
		clearInterval(this.heartbeat);
		this.heartbeat = setInterval(() => void this.sendRegistration(false).catch(() => {}), HEARTBEAT_MS);
		this.heartbeat.unref?.();
		this.updateStatus();
	}

	private async confirm(req: BridgeCallRequest): Promise<boolean> {
		const policy = process.env.PI_ARTIFACTS_MCP_APPROVAL;
		if (policy === "allow") return true;
		if (policy === "deny") return false;
		const ui = this.ui;
		if (!ui?.hasUI) return false;
		return ui.ui.confirm(
			"An artifact wants to run an MCP tool",
			`An artifact (it says it is "${req.artifactTitle}") wants to call ${req.name} with\n${JSON.stringify(req.args, null, 2).slice(0, 800)}\n\nAllow artifacts to use ${req.name} for the rest of this session?`,
		);
	}

	async shutdown(): Promise<void> {
		this.generation++;
		this.registrationAbort.abort();
		clearInterval(this.heartbeat);
		this.heartbeat = undefined;
		const registered = this.registered;
		if (registered) await registered.catch(() => {});
		clearInterval(this.heartbeat);
		this.heartbeat = undefined;
		await Promise.allSettled([...this.registrationRequests]);
		if (registered) await this.daemon.api("/sessions/unregister", { sessionId: this.sessionId }, { start: false, timeoutMs: REGISTRATION_TIMEOUT_MS }).catch(() => {});
		this.registered = undefined;
		await this.bridge?.close();
		this.bridge = undefined;
		this.runner = undefined;
		this.registrationAbort = new AbortController();
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
