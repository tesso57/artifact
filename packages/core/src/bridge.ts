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
