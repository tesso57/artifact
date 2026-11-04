import {
	BRIDGE_TOKEN_HEADER,
	getMemory,
	listArtifacts,
	type McpCallResult,
	type McpToolInfo,
	readCode,
	readMeta,
} from "@pi-artifacts/core";
import { artifactModuleUrl, VIEWER_DIR } from "@pi-artifacts/core";
import { createServerFn } from "@tanstack/react-start";

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export const listArtifactsFn = createServerFn({ method: "GET" }).handler(() => listArtifacts());

export const getArtifactFn = createServerFn({ method: "GET" })
	.validator((id: string) => id)
	.handler(async ({ data: id }) => {
		const meta = await readMeta(id);
		if (!meta) throw new Error(`Artifact "${id}" not found`);
		return { ...meta, moduleUrl: artifactModuleUrl(id, VIEWER_DIR) };
	});

export const getArtifactCodeFn = createServerFn({ method: "GET" })
	.validator((id: string) => id)
	.handler(async ({ data: id }) => (await readCode(id)) ?? "");

// ---------------------------------------------------------------------------
// Memory (SQLite)
// ---------------------------------------------------------------------------

type ScopeKey = { scope: string; key: string };

function checkScope(scope: string) {
	if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(scope)) throw new Error(`Invalid memory scope "${scope}"`);
}

export const memoryGetFn = createServerFn({ method: "POST" })
	.validator((d: ScopeKey) => d)
	.handler(({ data }) => {
		checkScope(data.scope);
		// `null` instead of undefined so the value survives serialization.
		return { value: getMemory().get(data.scope, data.key) ?? null };
	});

export const memorySetFn = createServerFn({ method: "POST" })
	.validator((d: ScopeKey & { value: unknown }) => d)
	.handler(({ data }) => {
		checkScope(data.scope);
		const entry = getMemory().set(data.scope, data.key, data.value ?? undefined);
		return { updatedAt: entry.updatedAt };
	});

export const memoryDeleteFn = createServerFn({ method: "POST" })
	.validator((d: ScopeKey) => d)
	.handler(({ data }) => {
		checkScope(data.scope);
		return { deleted: getMemory().delete(data.scope, data.key) };
	});

export const memoryListFn = createServerFn({ method: "POST" })
	.validator((d: { scope: string; prefix?: string }) => d)
	.handler(({ data }) => {
		checkScope(data.scope);
		return getMemory()
			.list(data.scope, data.prefix)
			.map((e) => ({ key: e.key, value: e.value as never, updatedAt: e.updatedAt }));
	});

// ---------------------------------------------------------------------------
// MCP, through the pi extension's bridge
// ---------------------------------------------------------------------------

async function bridge<T>(path: string, body?: unknown): Promise<T> {
	const url = process.env.PI_ARTIFACTS_BRIDGE_URL;
	const token = process.env.PI_ARTIFACTS_BRIDGE_TOKEN;
	if (!url || !token) {
		throw new Error("MCP is unavailable: the viewer was not started by the pi artifacts extension");
	}
	const res = await fetch(new URL(path, url), {
		method: body === undefined ? "GET" : "POST",
		headers: { [BRIDGE_TOKEN_HEADER]: token, "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = (await res.json()) as T & { error?: string };
	if (!res.ok) throw new Error(json.error ?? `Bridge error ${res.status}`);
	return json;
}

export const mcpStatusFn = createServerFn({ method: "GET" }).handler(async () => {
	if (!process.env.PI_ARTIFACTS_BRIDGE_URL) return { connected: false, ready: false };
	try {
		return { connected: true, ...(await bridge<{ ready: boolean }>("/status")) };
	} catch {
		return { connected: false, ready: false };
	}
});

export const mcpListToolsFn = createServerFn({ method: "GET" }).handler(async () => {
	const { tools } = await bridge<{ tools: McpToolInfo[] }>("/mcp/tools");
	return tools.map((t) => ({ ...t, inputSchema: t.inputSchema as never }));
});

export const mcpCallFn = createServerFn({ method: "POST" })
	.validator((d: { name: string; args?: Record<string, unknown>; artifactId?: string }) => d)
	.handler(async ({ data }) => {
		const r = await bridge<McpCallResult>("/mcp/call", data);
		return { ...r, data: (r.data ?? null) as never, content: r.content as never[] };
	});
