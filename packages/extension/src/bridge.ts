import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { BRIDGE_TOKEN_HEADER, type McpCallResult, type McpToolInfo, parseMcpToolName } from "@pi-artifacts/core";

/** The subset of pi's tool context the bridge needs (`ctx.tools` / `ctx.executeTool`). */
export interface ToolRunner {
	readonly tools: readonly { name: string; description: string; parameters: unknown }[];
	executeTool(
		name: string,
		args: unknown,
		options?: { signal?: AbortSignal },
	): Promise<{ isError: boolean; result: { content?: unknown[]; structuredContent?: unknown } }>;
}

export interface BridgeOptions {
	/** Latest tool context captured from an artifact tool call, if any. */
	getRunner(): ToolRunner | undefined;
	/** Every MCP tool known to pi, used for listing before a runner exists. */
	listAllTools(): { name: string; description: string; parameters: unknown }[];
	/** Called for every MCP call (for the TUI status / logging). */
	onCall?(name: string, artifactId: string | undefined): void;
	/** Per-call timeout in ms. */
	timeoutMs?: number;
	/** How long a call waits for its MCP server to connect (its tool to appear). Default 15s. */
	connectWaitMs?: number;
}

const MAX_BODY = 1024 * 1024;

function toInfo(t: { name: string; description: string; parameters: unknown }): McpToolInfo | undefined {
	const parts = parseMcpToolName(t.name);
	if (!parts) return undefined;
	return { name: t.name, ...parts, description: t.description, inputSchema: t.parameters };
}

export function textOf(content: unknown[] | undefined): string {
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
export function parseData(text: string, structured: unknown): unknown {
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

/**
 * HTTP handler of the bridge. Only `mcp__*` tools can be called: artifacts must
 * not reach pi's bash/edit/write tools. Calls go through `ctx.executeTool`, so
 * pi's hooks and permission gates apply to them like model-issued calls.
 */
export function createBridgeHandler(token: string, opts: BridgeOptions) {
	return async (req: IncomingMessage, res: ServerResponse) => {
		try {
			if (!tokenMatches(req.headers[BRIDGE_TOKEN_HEADER], token)) return send(res, 401, { error: "Unauthorized" });
			const url = new URL(req.url ?? "/", "http://bridge");

			if (req.method === "GET" && url.pathname === "/status") {
				return send(res, 200, { ready: !!opts.getRunner() });
			}

			if (req.method === "GET" && url.pathname === "/mcp/tools") {
				const source = opts.getRunner()?.tools ?? opts.listAllTools();
				const tools = source.map(toInfo).filter((t): t is McpToolInfo => !!t);
				return send(res, 200, { tools });
			}

			if (req.method === "POST" && url.pathname === "/mcp/call") {
				const body = (await readJson(req)) as { name?: unknown; args?: unknown; artifactId?: unknown };
				const name = typeof body.name === "string" ? body.name : "";
				if (!parseMcpToolName(name)) return send(res, 400, { error: `Only MCP tools (mcp__<server>__<tool>) can be called, got "${name}"` });
				const runner = opts.getRunner();
				if (!runner) {
					return send(res, 503, {
						error: "pi is not ready to run MCP tools yet: ask the agent to write or refresh an artifact (artifact_write) in this session first",
					});
				}
				// MCP servers connect in the background; give a server that is still connecting a moment.
				const deadline = Date.now() + (opts.connectWaitMs ?? 15_000);
				while (!runner.tools.some((t) => t.name === name) && Date.now() < deadline) {
					await new Promise((r) => setTimeout(r, 200));
				}
				if (!runner.tools.some((t) => t.name === name)) {
					return send(res, 404, { error: `MCP tool "${name}" is not available in pi (is its server connected? see /mcp)` });
				}
				opts.onCall?.(name, typeof body.artifactId === "string" ? body.artifactId : undefined);
				const signal = AbortSignal.timeout(opts.timeoutMs ?? 120_000);
				const outcome = await runner.executeTool(name, body.args ?? {}, { signal });
				const text = textOf(outcome.result.content);
				const result: McpCallResult = {
					isError: outcome.isError,
					text,
					data: parseData(text, outcome.result.structuredContent),
					content: outcome.result.content ?? [],
				};
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
