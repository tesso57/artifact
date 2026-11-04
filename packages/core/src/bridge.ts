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
