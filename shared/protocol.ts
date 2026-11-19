
export interface McpToolInfo {
	name: string;
	server: string;
	tool: string;
	description: string;
	inputSchema: unknown;
	readOnly?: boolean;
}

export interface McpCallResult {
	isError: boolean;
	text: string;
	data?: unknown;
}

export type MemorySnapshot = { found: false } | { found: true; value: unknown };

export const BRIDGE_TOKEN_HEADER = "x-pi-artifacts-token";
export const PROTOCOL_VERSION = 2;
export const DAEMON_SECRET_HEADER = "x-pi-artifacts-secret";
export const SESSION_COOKIE = "pi_artifacts";

export interface DaemonState {
	protocol: number;
	pid: number;
	port: number;
	url: string;
	secret: string;
	version: string;
	startedAt: number;
}

export interface SessionRegistration {
	sessionId: string;
	cwd: string;
	bridgeUrl: string;
	bridgeToken: string;
	ready?: boolean;
	tools?: string[];
}

export interface BridgeCallRequest {
	name: string;
	args: Record<string, unknown>;
	artifactId: string;
	artifactTitle: string;
}

export interface ArtifactMeta {
	id: string;
	instanceId?: string;
	title: string;
	description?: string;
	cwd?: string;
	sessionId?: string;
	mcp?: string[];
	createdAt: number;
	updatedAt: number;
}

export interface RuntimeError {
	message: string;
	stack?: string;
	at: number;
}

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

export function parseMcpToolName(name: string): { server: string; tool: string } | undefined {
	const m = /^mcp__(.+?)__(.+)$/.exec(name);
	return m ? { server: m[1], tool: m[2] } : undefined;
}

export function normalizeMcpToolName(nameOrServer: string, tool?: string): string {
	if (tool) return `mcp__${nameOrServer}__${tool}`;
	if (nameOrServer.startsWith("mcp__")) return nameOrServer;
	const dot = nameOrServer.indexOf(".");
	return dot > 0 ? `mcp__${nameOrServer.slice(0, dot)}__${nameOrServer.slice(dot + 1)}` : nameOrServer;
}

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

export function memoryMatches(value: unknown, expected: MemorySnapshot): boolean {
	return expected.found ? value !== undefined && stableStringify(value) === stableStringify(expected.value) : value === undefined;
}

export function normalizeMcpArgs(args: unknown): Record<string, unknown> {
	const candidate = args && typeof args === "object" ? args : {};
	const value: unknown = JSON.parse(JSON.stringify(candidate) ?? "{}");
	return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function mcpCallKey(name: string, args: unknown): string {
	return `${name} ${stableStringify(normalizeMcpArgs(args))}`;
}
