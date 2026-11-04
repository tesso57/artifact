// Browser-safe: no Node imports here (the viewer SDK imports this module in the browser).
/** Wire types for the pi ⇄ viewer bridge (the pi extension serves it, the viewer server calls it). */

export interface McpToolInfo {
	/** Full pi tool name, e.g. `mcp__github__search_issues`. */
	name: string;
	/** MCP server name, e.g. `github`. */
	server: string;
	/** Tool name on that server, e.g. `search_issues`. */
	tool: string;
	description: string;
	inputSchema: unknown;
}

export interface McpCallResult {
	isError: boolean;
	/** Concatenated text blocks of the result. */
	text: string;
	/** `structuredContent` when the tool returned one, else parsed JSON of `text` when it is JSON. */
	data?: unknown;
	content: unknown[];
}

export const BRIDGE_TOKEN_HEADER = "x-pi-artifacts-token";

/** Split `mcp__<server>__<tool>` into its parts. */
export function parseMcpToolName(name: string): { server: string; tool: string } | undefined {
	const m = /^mcp__(.+?)__(.+)$/.exec(name);
	return m ? { server: m[1], tool: m[2] } : undefined;
}

/**
 * Accept `"mcp__server__tool"`, `"server.tool"`, or (`"server"`, `"tool"`) and return the pi
 * tool name `mcp__server__tool`.
 */
export function normalizeMcpToolName(nameOrServer: string, tool?: string): string {
	if (tool) return `mcp__${nameOrServer}__${tool}`;
	if (nameOrServer.startsWith("mcp__")) return nameOrServer;
	const dot = nameOrServer.indexOf(".");
	return dot > 0 ? `mcp__${nameOrServer.slice(0, dot)}__${nameOrServer.slice(dot + 1)}` : nameOrServer;
}

/** Memory scope where the viewer keeps the latest result of each MCP call, for exports. */
export const MCP_CACHE_SCOPE = "mcp-cache";

/** JSON with sorted object keys, so equal arguments give equal cache keys. */
export function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** Cache key of an MCP call made by an artifact (prefix `<artifactId> ` lists one artifact's calls). */
export function mcpCacheKey(artifactId: string, name: string, args: unknown): string {
	return `${artifactId} ${name} ${stableStringify(args ?? {})}`;
}
