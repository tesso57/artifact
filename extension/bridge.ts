/**
 * The MCP bridge: a loopback HTTP server inside pi that the viewer daemon calls to run
 * MCP tools for artifacts. Only `mcp__*` tools can be called; tools that are not marked
 * read-only need the user's approval once per artifact and tool (when a UI is present).
 * Calls go through `ctx.executeTool`, so pi's hooks and permission gates apply as well.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
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
	annotations?: { readOnlyHint?: boolean };
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
function parseData(text: string, structured: unknown): unknown {
	if (structured && typeof structured === "object" && Array.isArray((structured as { content?: unknown }).content)) {
		const inner = (structured as { structuredContent?: unknown }).structuredContent;
		if (inner !== undefined) return inner;
	} else if (structured !== undefined) {
		return structured;
	}
	const trimmed = text.trim();
	if (!/^[[{]/.test(trimmed)) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function send(res: ServerResponse, status: number, body: unknown) {
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

function createBridgeHandler(token: string, opts: BridgeOptions) {
	/** (artifact, tool) pairs the user approved in this session. */
	const approved = new Set<string>();

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
				const deadline = Date.now() + (opts.connectWaitMs ?? 15_000);
				while (!runner.tools.some((t) => t.name === call.name) && Date.now() < deadline) {
					await new Promise((r) => setTimeout(r, 200));
				}
				if (!runner.tools.some((t) => t.name === call.name)) {
					return send(res, 404, { error: `MCP tool "${call.name}" is not available in pi (is its server connected? see /mcp)` });
				}
				const readOnly = !!opts.listAllTools().find((t) => t.name === call.name)?.annotations?.readOnlyHint;
				const pair = `${call.artifactId}\u0000${call.name}`;
				if (!readOnly && !approved.has(pair) && opts.confirm) {
					if (!(await opts.confirm(call))) return send(res, 403, { error: `The user declined ${call.name} for this artifact` });
					approved.add(pair);
				}
				opts.onCall?.(call);
				const outcome = await runner.executeTool(call.name, call.args, { signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000) });
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
	const server: Server = createServer(createBridgeHandler(token, opts));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		token,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}
