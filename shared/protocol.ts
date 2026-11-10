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

/** A memory value can be absent or present with any JSON value, including null. */
export type MemorySnapshot = { found: false } | { found: true; value: unknown };

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
	/** Identifies one creation of an id; absent in metadata written by older versions. */
	instanceId?: string;
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

/** Compare SemVer precedence; build metadata does not affect ordering. */
export function compareVersions(a: string, b: string): number {
	const split = (value: string) => {
		const withoutBuild = value.split("+", 1)[0];
		const separator = withoutBuild.indexOf("-");
		return {
			core: (separator < 0 ? withoutBuild : withoutBuild.slice(0, separator)).split("."),
			pre: separator < 0 ? undefined : withoutBuild.slice(separator + 1).split("."),
		};
	};
	const numeric = (left: string, right: string) => {
		const x = left.replace(/^0+(?=\d)/, "");
		const y = right.replace(/^0+(?=\d)/, "");
		return x.length !== y.length ? Math.sign(x.length - y.length) : x === y ? 0 : x < y ? -1 : 1;
	};
	const left = split(a);
	const right = split(b);
	for (let i = 0; i < 3; i++) {
		const order = numeric(left.core[i] ?? "0", right.core[i] ?? "0");
		if (order) return order;
	}
	if (!left.pre || !right.pre) return left.pre ? -1 : right.pre ? 1 : 0;
	for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
		const x = left.pre[i];
		const y = right.pre[i];
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		if (x === y) continue;
		const xn = /^\d+$/.test(x);
		const yn = /^\d+$/.test(y);
		if (xn && yn) {
			const order = numeric(x, y);
			if (order) return order;
			continue;
		}
		if (xn !== yn) return xn ? -1 : 1;
		return x < y ? -1 : 1;
	}
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

/**
 * Whether `toolName` (pi name) matches an artifact's `mcp` allowlist: `server.tool` or
 * `server.*`. There is no global `*` — artifact ids are claims, so one artifact allowing
 * everything would let every artifact reach every tool.
 */
export function mcpAllowed(allow: readonly string[] | undefined, toolName: string): boolean {
	const parts = parseMcpToolName(toolName);
	if (!parts || !allow?.length) return false;
	return allow.some((pattern) => {
		const p = normalizeMcpToolName(pattern);
		const allowed = parseMcpToolName(p);
		if (!allowed) return false;
		if (allowed.tool === "*") return parts.server === allowed.server;
		return p === toolName;
	});
}

/** JSON with sorted object keys, matching the values actually sent to MCP. */
export function stableStringify(value: unknown): string {
	const json = JSON.stringify(value);
	if (json === undefined) return "null";
	const canonical = (item: unknown): string => {
		if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
		if (item && typeof item === "object") {
			const entries = Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
			return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(",")}}`;
		}
		return JSON.stringify(item) ?? "null";
	};
	return canonical(JSON.parse(json));
}

/** Compare JSON values without depending on object key order. */
export function memoryMatches(value: unknown, expected: MemorySnapshot): boolean {
	return expected.found ? value !== undefined && stableStringify(value) === stableStringify(expected.value) : value === undefined;
}

/** Match the bridge's JSON-object argument handling before sending or caching a call. */
export function normalizeMcpArgs(args: unknown): Record<string, unknown> {
	const candidate = args && typeof args === "object" ? args : {};
	const value: unknown = JSON.parse(JSON.stringify(candidate) ?? "{}");
	return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** Key of an MCP call (tool + arguments) within one artifact. */
export function mcpCallKey(name: string, args: unknown): string {
	return `${name} ${stableStringify(normalizeMcpArgs(args))}`;
}
