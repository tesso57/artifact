// Browser-safe: no Node imports (the viewer SDK imports this module in the browser).
/**
 * Wire types between the three parties:
 *   pi extension  ──HTTP (secret header)──▶  viewer daemon  ──HTTP (bridge token)──▶  pi bridge
 *   browser       ──server fns (cookie)──▶   viewer daemon
 */

export interface McpToolInfo {
	/** Full pi tool name, e.g. `mcp__github__search_issues`. */
	name: string;
	server: string;
	tool: string;
	description: string;
	inputSchema: unknown;
	readOnly?: boolean;
}

/** An MCP result as artifacts see it. */
export interface McpCallResult {
	isError: boolean;
	/** Concatenated text blocks of the result. */
	text: string;
	/** The server's `structuredContent`, else `text` parsed as JSON when it looks like JSON. */
	data?: unknown;
}

export const BRIDGE_TOKEN_HEADER = "x-pi-artifacts-token";
/** Bumped when the daemon API changes incompatibly; clients only use daemons with the same one. */
export const PROTOCOL_VERSION = 1;
export const DAEMON_SECRET_HEADER = "x-pi-artifacts-secret";
export const SESSION_COOKIE = "pi_artifacts";

/** Written by the daemon to `<state>/viewer.json`; the extension reads it to find the daemon. */
export interface DaemonState {
	protocol: number;
	pid: number;
	port: number;
	url: string;
	secret: string;
	version: string;
	startedAt: number;
}

/** A pi session registered with the daemon (heartbeat keeps it alive). */
export interface SessionRegistration {
	sessionId: string;
	cwd: string;
	bridgeUrl: string;
	bridgeToken: string;
	/** Whether the session can run tools (it captured a tool context). */
	ready?: boolean;
	/** MCP tools (`mcp__…`) the session has. */
	tools?: string[];
}

/** Body the daemon sends to a session's bridge. */
export interface BridgeCallRequest {
	name: string;
	args: Record<string, unknown>;
	artifactId: string;
	artifactTitle: string;
}

export interface ArtifactMeta {
	id: string;
	title: string;
	description?: string;
	cwd?: string;
	/** pi session that last wrote it; MCP calls go there first. */
	sessionId?: string;
	/** MCP tools the artifact may call: `server.tool`, `server.*` or `*`. */
	mcp?: string[];
	createdAt: number;
	updatedAt: number;
}

export interface RuntimeError {
	message: string;
	stack?: string;
	at: number;
}

/** Compare dotted versions numerically (`1.10.0` > `1.9.3`); pre-release tags are ignored. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
	const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
	return 0;
}

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

/** Whether `toolName` (pi name) matches an artifact's `mcp` allowlist. */
export function mcpAllowed(allow: readonly string[] | undefined, toolName: string): boolean {
	const parts = parseMcpToolName(toolName);
	if (!parts || !allow?.length) return false;
	return allow.some((pattern) => {
		if (pattern === "*") return true;
		const p = normalizeMcpToolName(pattern);
		if (p.endsWith("__*")) return toolName.startsWith(p.slice(0, -1));
		if (pattern.endsWith(".*")) return parts.server === pattern.slice(0, -2);
		return p === toolName;
	});
}

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

/** Key of an MCP call (tool + arguments) within one artifact. */
export function mcpCallKey(name: string, args: unknown): string {
	return `${name} ${stableStringify(args ?? {})}`;
}
