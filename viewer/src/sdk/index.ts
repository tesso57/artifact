/**
 * `@pi/artifact` — the runtime SDK available to every artifact.
 *
 *   import { useMemory, useMcp, callMcp } from "@pi/artifact";
 *
 * Memory is a small SQLite key/value store. By default keys are scoped to the current
 * artifact; pass `{ scope: "shared" }` to share data between artifacts.
 *
 * MCP calls go to a pi session connected to the viewer, so artifacts can use the MCP
 * servers connected to pi. An artifact may only call the tools in its `mcp` allowlist.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useCallback, useContext, useMemo, useRef } from "react";
import { backend } from "@/sdk/backend";
import { normalizeMcpToolName } from "../../../shared/protocol.ts";
import { ArtifactContext, currentArtifactId } from "./context";

export { type ArtifactInfo, useArtifact } from "./context";
export type { McpCallResult, McpToolInfo } from "../../../shared/protocol.ts";

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface MemoryOptions {
	/** Defaults to the current artifact's id. Use "shared" to share across artifacts. */
	scope?: string;
}

function useScope(scope?: string): string {
	const artifact = useContext(ArtifactContext);
	const resolved = scope ?? artifact?.id;
	if (!resolved) throw new Error("Memory needs a scope outside an artifact");
	return resolved;
}

const memoryKey = (scope: string, key: string) => ["pi-memory", scope, key] as const;

/** Writes to one key are sent in order, so the last `set` always wins. */
const writeChains = new Map<string, Promise<unknown>>();
function serialized<T>(chainKey: string, run: () => Promise<T>): Promise<T> {
	const next = (writeChains.get(chainKey) ?? Promise.resolve()).catch(() => {}).then(run);
	writeChains.set(chainKey, next);
	void next.finally(() => writeChains.get(chainKey) === next && writeChains.delete(chainKey)).catch(() => {});
	return next;
}

/** Imperative memory API. `scope` is required outside of hooks. */
export const memory = {
	get: <T>(scope: string, key: string) => backend.memoryGet(scope, key, currentArtifactId()) as Promise<T | undefined>,
	set: (scope: string, key: string, value: unknown) =>
		serialized(`${scope}\u0000${key}`, () => backend.memorySet(scope, key, value)),
	delete: (scope: string, key: string) => serialized(`${scope}\u0000${key}`, () => backend.memoryDelete(scope, key)),
	list: (scope: string, prefix?: string) => backend.memoryList(scope, prefix, currentArtifactId()),
};

/** "live" in the viewer, "static" in an exported HTML file (memory in localStorage, MCP from a snapshot). */
export const runtimeMode = backend.mode;

/**
 * Persistent state, like `useState` but stored in SQLite.
 *
 *   const [todos, setTodos] = useMemory<string[]>("todos", []);
 */
export function useMemory<T>(
	key: string,
	initial: T,
	options: MemoryOptions = {},
): [T, (next: T | ((prev: T) => T)) => void, { loading: boolean; error: unknown }] {
	const scope = useScope(options.scope);
	const qc = useQueryClient();
	const queryKey = useMemo(() => memoryKey(scope, key), [scope, key]);
	// `initial` is only a default; keep the latest without re-creating callbacks on every render.
	const initialRef = useRef(initial);
	initialRef.current = initial;
	const query = useQuery({
		queryKey,
		queryFn: async () => (await memory.get<T>(scope, key)) ?? initialRef.current,
	});
	const { mutate, error: mutationError } = useMutation({
		mutationFn: (value: T) => memory.set(scope, key, value),
		onError: () => qc.invalidateQueries({ queryKey }),
	});
	const set = useCallback(
		(next: T | ((prev: T) => T)) => {
			const prev = qc.getQueryData<T>(queryKey) ?? initialRef.current;
			const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
			qc.setQueryData(queryKey, value);
			mutate(value);
		},
		[qc, queryKey, mutate],
	);
	return [(query.data ?? initial) as T, set, { loading: query.isPending, error: query.error ?? mutationError }];
}

/** Every entry of a scope (optionally under a key prefix). */
export function useMemoryList(options: MemoryOptions & { prefix?: string } = {}) {
	const scope = useScope(options.scope);
	return useQuery({
		queryKey: ["pi-memory-list", scope, options.prefix ?? ""],
		queryFn: () => memory.list(scope, options.prefix),
	});
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

/**
 * Call an MCP tool through pi. Accepts `"mcp__github__search_issues"`,
 * `"github.search_issues"`, or `("github", "search_issues")`.
 * Throws when the tool reports an error.
 */
export async function callMcp<T = unknown>(name: string, args: Record<string, unknown> = {}) {
	const artifactId = currentArtifactId();
	if (!artifactId) throw new Error("callMcp() must be used inside an artifact");
	const result = await backend.mcpCall(normalizeMcpToolName(name), args, artifactId);
	if (result.isError) throw new Error(result.text || `MCP tool ${name} failed`);
	return { ...result, data: result.data as T };
}

/** Whether a pi session is connected to the viewer (MCP calls need one). */
export function useMcpStatus() {
	return useQuery({ queryKey: ["pi-mcp-status"], queryFn: () => backend.mcpStatus(), refetchInterval: 5000 });
}

/** MCP tools pi can call right now (the artifact may only call those in its allowlist). */
export function useMcpTools() {
	return useQuery({ queryKey: ["pi-mcp-tools"], queryFn: () => backend.mcpTools(), staleTime: 30_000 });
}

/**
 * Query an MCP tool with TanStack Query (cached, refetchable).
 *
 *   const { data, isPending, error, refetch } = useMcp("github.search_issues", { q: "bug" });
 */
export function useMcp<T = unknown>(
	name: string,
	args: Record<string, unknown> = {},
	options: Omit<UseQueryOptions<{ text: string; data: T }>, "queryKey" | "queryFn"> = {},
) {
	return useQuery({
		queryKey: ["pi-mcp", normalizeMcpToolName(name), args],
		queryFn: () => callMcp<T>(name, args),
		staleTime: 60_000,
		...options,
	});
}

/** Run an MCP tool on demand (buttons, forms). */
export function useMcpMutation<T = unknown>(name: string) {
	return useMutation({ mutationFn: (args: Record<string, unknown> = {}) => callMcp<T>(name, args) });
}
