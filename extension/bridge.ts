/**
 * The MCP bridge: a loopback HTTP server inside pi that the viewer daemon calls to run
 * MCP tools for artifacts. Only `mcp__*` tools can be called. A tool runs without asking
 * only when its server marks it read-only *and* closed-world; anything else needs the
 * user's approval once per tool in this session. (Approval is not keyed by artifact: all
 * artifacts share one origin, so the calling artifact's id is a claim, not a proof.)
 * Calls go through `ctx.executeTool`, so pi's hooks and permission gates apply as well.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import {
	BRIDGE_TOKEN_HEADER,
	type BridgeCallRequest,
	type McpCallResult,
	type McpToolInfo,
	parseMcpToolName,
} from "../shared/protocol.ts";

/** The subset of pi's tool context the bridge needs (`ctx.tools` / `ctx.executeTool`). */
export interface ToolRunner {
	readonly tools: readonly { name: string; description: string; parameters: unknown }[];
	executeTool(
		name: string,
		args: unknown,
		options?: { signal?: AbortSignal },
	): Promise<{ isError: boolean; result: { content?: unknown[]; structuredContent?: unknown } }>;
}

export interface ToolListing {
	name: string;
	description: string;
	parameters: unknown;
	annotations?: { readOnlyHint?: boolean; openWorldHint?: boolean };
}

interface BridgeOptions {
	/** Latest tool context captured from an artifact tool call, if any. */
	getRunner(): ToolRunner | undefined;
	/** Every tool known to pi, with annotations (for listing and the read-only check). */
	listAllTools(): ToolListing[];
	/** Ask the user whether an artifact may run a tool that can change things. */
	confirm?(req: BridgeCallRequest): Promise<boolean>;
	/** Called for every MCP call (for the TUI status). */
	onCall?(req: BridgeCallRequest): void;
	timeoutMs?: number;
	/** How long a call waits for its MCP server to connect (its tool to appear). Default 15s. */
	connectWaitMs?: number;
}

const MAX_BODY = 1024 * 1024;

function toInfo(t: ToolListing): McpToolInfo | undefined {
	const parts = parseMcpToolName(t.name);
	if (!parts) return undefined;
	return { name: t.name, ...parts, description: t.description, inputSchema: t.parameters, readOnly: !!t.annotations?.readOnlyHint };
}

/** Safe to run unasked: the server says it only reads, and only from a closed world. */
function runsWithoutApproval(t: ToolListing | undefined): boolean {
	return t?.annotations?.readOnlyHint === true && t.annotations.openWorldHint === false;
}

function textOf(content: unknown[] | undefined): string {
	return (content ?? [])
		.filter((b): b is { type: "text"; text: string } => (b as { type?: string })?.type === "text")
		.map((b) => b.text)
		.join("\n");
}

/**
 * pi's MCP tools return the whole MCP `CallToolResult` (`{ content, structuredContent?, isError? }`)
 * as their `structuredContent`. Use the server's own `structuredContent` when it sent one, else
 * JSON-looking text.
 */
function checkedJsonNumber(value: unknown): unknown {
	if (typeof value === "number" && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
		throw new Error("JSON number cannot be represented safely");
	}
	return value;
}

function safeJsonValue(value: unknown): unknown {
	try {
		const json = JSON.stringify(value, (_key, item: unknown) => checkedJsonNumber(item));
		return json === undefined ? undefined : JSON.parse(json);
	} catch {
		return undefined;
	}
}

function parseData(text: string, structured: unknown): unknown {
	if (structured && typeof structured === "object" && Array.isArray((structured as { content?: unknown }).content)) {
		const inner = (structured as { structuredContent?: unknown }).structuredContent;
		if (inner !== undefined) return safeJsonValue(inner);
	} else if (structured !== undefined) {
		return safeJsonValue(structured);
	}
	const trimmed = text.trim();
	try {
		// Node 22.19+ exposes the original primitive token to the reviver. It lets us
		// distinguish a real zero from a nonzero exponent rounded down to zero.
		const parse = JSON.parse as unknown as (text: string, reviver: (key: string, value: unknown, context?: { source?: string }) => unknown) => unknown;
		return parse(trimmed, (_key, value, context) => {
			if (value === 0 && context?.source && /[1-9]/.test(context.source.split(/[eE]/, 1)[0])) throw new Error("JSON number underflows");
			return checkedJsonNumber(value);
		});
	} catch {
		return undefined;
	}
}

function send(res: ServerResponse, status: number, body: unknown) {
	if (res.destroyed) return;
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY) throw new Error("Request body too large");
		chunks.push(chunk as Buffer);
	}
	return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function tokenMatches(given: string | string[] | undefined, expected: string): boolean {
	if (typeof given !== "string") return false;
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

async function waitForTool<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	let abort!: () => void;
	const cancelled = new Promise<never>((_resolve, reject) => {
		abort = () => reject(signal.reason);
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
	});
	try { return await Promise.race([operation, cancelled]); }
	finally { signal.removeEventListener("abort", abort); }
}

function createBridgeHandler(token: string, opts: BridgeOptions, shutdownSignal: AbortSignal) {
	/** Tools the user approved for artifacts in this session. */
	const approved = new Set<string>();
	const pendingApprovals = new Map<string, Promise<boolean>>();

	function requestApproval(call: BridgeCallRequest): Promise<boolean> {
		if (!opts.confirm) return Promise.resolve(false);
		const existing = pendingApprovals.get(call.name);
		if (existing) return existing;
		const pending = Promise.resolve().then(() => opts.confirm!(call));
		pendingApprovals.set(call.name, pending);
		const clear = () => { if (pendingApprovals.get(call.name) === pending) pendingApprovals.delete(call.name); };
		void pending.then(clear, clear);
		return pending;
	}

	return async (req: IncomingMessage, res: ServerResponse) => {
		try {
			if (!tokenMatches(req.headers[BRIDGE_TOKEN_HEADER], token)) return send(res, 401, { error: "Unauthorized" });
			const url = new URL(req.url ?? "/", "http://bridge");

			if (req.method === "GET" && url.pathname === "/mcp/tools") {
				const tools = opts.listAllTools().map(toInfo).filter((t): t is McpToolInfo => !!t);
				return send(res, 200, { tools });
			}

			if (req.method === "POST" && url.pathname === "/mcp/call") {
				const body = (await readJson(req)) as Partial<BridgeCallRequest>;
				if (shutdownSignal.aborted) return;
				const call: BridgeCallRequest = {
					name: typeof body.name === "string" ? body.name : "",
					args: body.args && typeof body.args === "object" ? body.args : {},
					artifactId: String(body.artifactId ?? ""),
					artifactTitle: String(body.artifactTitle ?? body.artifactId ?? ""),
				};
				if (!parseMcpToolName(call.name)) {
					return send(res, 400, { error: `Only MCP tools (mcp__<server>__<tool>) can be called, got "${call.name}"` });
				}
				const runner = opts.getRunner();
				if (!runner) {
					return send(res, 503, {
						error: "pi is not ready to run MCP tools yet: ask the agent to write or refresh an artifact in this session",
					});
				}
				// MCP servers connect in the background; give a server that is still connecting a moment.
				const deadline = performance.now() + (opts.connectWaitMs ?? 15_000);
				while (!shutdownSignal.aborted && !runner.tools.some((t) => t.name === call.name) && performance.now() < deadline) {
					await new Promise((r) => setTimeout(r, 200));
				}
				if (shutdownSignal.aborted) return;
				if (!runner.tools.some((t) => t.name === call.name)) {
					return send(res, 404, { error: `MCP tool "${call.name}" is not available in pi (is its server connected? see /mcp)` });
				}
				if (!runsWithoutApproval(opts.listAllTools().find((t) => t.name === call.name)) && !approved.has(call.name)) {
					if (!(await requestApproval(call))) return send(res, 403, { error: `The user declined ${call.name} for artifacts` });
					if (shutdownSignal.aborted) return;
					approved.add(call.name);
				}
				opts.onCall?.(call);
				const timeout = AbortSignal.timeout(opts.timeoutMs ?? 120_000);
				const signal = AbortSignal.any([shutdownSignal, timeout]);
				let outcome: Awaited<ReturnType<ToolRunner["executeTool"]>>;
				try {
					outcome = await waitForTool(runner.executeTool(call.name, call.args, { signal }), signal);
				} catch (error) {
					if (timeout.aborted && !shutdownSignal.aborted) return send(res, 504, { error: `MCP tool ${call.name} timed out; it may still be running` });
					throw error;
				}
				const text = textOf(outcome.result.content);
				const result: McpCallResult = { isError: outcome.isError, text, data: parseData(text, outcome.result.structuredContent) };
				return send(res, 200, result);
			}

			send(res, 404, { error: "Not found" });
		} catch (error) {
			send(res, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}

export interface Bridge {
	url: string;
	token: string;
	close(): Promise<void>;
}

/** Start the bridge on a random loopback port. */
export async function startBridge(opts: BridgeOptions): Promise<Bridge> {
	const token = randomBytes(24).toString("base64url");
	const shutdown = new AbortController();
	const server: Server = createServer(createBridgeHandler(token, opts, shutdown.signal));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const { port } = server.address() as AddressInfo;
	let closing: Promise<void> | undefined;
	return {
		url: `http://127.0.0.1:${port}`,
		token,
		close: () => (closing ??= new Promise((resolve) => {
			shutdown.abort();
			server.close(() => resolve());
			server.closeAllConnections();
		})),
	};
}
