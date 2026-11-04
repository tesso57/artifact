/**
 * `@pi/artifact` — the runtime SDK available to every artifact.
 *
 *   import { useMemory, useMcp, callMcp } from "@pi/artifact";
 *
 * Memory is a small SQLite key/value store. By default keys are scoped to the
 * current artifact; pass `{ scope: "shared" }` to share data between artifacts.
 *
 * MCP calls go to the pi agent that started the viewer, so artifacts can use
 * any MCP server connected to pi (`mcp__<server>__<tool>`).
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
// Browser-safe subpath: the package root also exports Node-only modules.
import { normalizeMcpToolName } from "@pi-artifacts/core/bridge";
import { useCallback, useContext, useMemo, useRef } from "react";
import {
	mcpCallFn,
	mcpListToolsFn,
	mcpStatusFn,
	memoryDeleteFn,
	memoryGetFn,
	memoryListFn,
	memorySetFn,
} from "../server/fns";
import { ArtifactContext } from "./context";

export { type ArtifactInfo, useArtifact } from "./context";
export type { McpCallResult, McpToolInfo } from "@pi-artifacts/core/bridge";

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

/** Imperative memory API. `scope` is required outside of hooks. */
export const memory = {
	async get<T>(scope: string, key: string): Promise<T | undefined> {
		const { value } = await memoryGetFn({ data: { scope, key } });
		return (value ?? undefined) as T | undefined;
	},
	async set(scope: string, key: string, value: unknown): Promise<void> {
		await memorySetFn({ data: { scope, key, value } });
	},
	async delete(scope: string, key: string): Promise<boolean> {
		return (await memoryDeleteFn({ data: { scope, key } })).deleted;
	},
	async list(scope: string, prefix?: string) {
		return memoryListFn({ data: { scope, prefix } });
	},
};

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
export async function callMcp<T = unknown>(
	name: string,
	args: Record<string, unknown> = {},
	options: { artifactId?: string } = {},
) {
	const result = await mcpCallFn({ data: { name: normalizeMcpToolName(name), args, artifactId: options.artifactId } });
	if (result.isError) throw new Error(result.text || `MCP tool ${name} failed`);
	return { ...result, data: result.data as T };
}

/** Status of the bridge to pi (`connected`) and whether it can run tools yet (`ready`). */
export function useMcpStatus() {
	return useQuery({ queryKey: ["pi-mcp-status"], queryFn: () => mcpStatusFn(), refetchInterval: 5000 });
}

/** MCP tools pi can call right now. */
export function useMcpTools() {
	return useQuery({ queryKey: ["pi-mcp-tools"], queryFn: () => mcpListToolsFn(), staleTime: 30_000 });
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
	const artifact = useContext(ArtifactContext);
	return useQuery({
		queryKey: ["pi-mcp", normalizeMcpToolName(name), args],
		queryFn: () => callMcp<T>(name, args, { artifactId: artifact?.id }),
		staleTime: 60_000,
		...options,
	});
}

/** Run an MCP tool on demand (buttons, forms). */
export function useMcpMutation<T = unknown>(name: string) {
	const artifact = useContext(ArtifactContext);
	return useMutation({
		mutationFn: (args: Record<string, unknown> = {}) => callMcp<T>(name, args, { artifactId: artifact?.id }),
	});
}
