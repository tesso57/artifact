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
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { backend } from "@/sdk/backend";
import { SHARED_SCOPE } from "../../../shared/ids.ts";
import { normalizeMcpToolName, type MemorySnapshot } from "../../../shared/protocol.ts";
import { ArtifactContext, currentArtifactId } from "./context";
import { invalidateMemoryQueries, serializeMemoryWrite, subscribeMemoryChanges } from "./memory-sync";

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

const memoryKey = (scope: string, key: string, caller?: string) => ["pi-memory", scope, key, scope === SHARED_SCOPE ? caller : undefined] as const;
type MemoryCache<T> = { found: false } | { found: true; value: T };
type MemoryWrite<T> = { scope: string; key: string; caller?: string; initial: T; value: T | undefined; expected: MemorySnapshot; update?: (previous: T) => T | undefined };

function jsonMemoryValue<T>(value: T | undefined): T | undefined {
	if (value === undefined) return undefined;
	try {
		const json = JSON.stringify(value);
		if (json === undefined) throw new Error("Value has no JSON representation");
		return JSON.parse(json) as T;
	} catch (error) {
		throw new Error("Memory values must be JSON serializable", { cause: error });
	}
}
function useMemoryUpdates(scope: string) {
	const qc = useQueryClient();
	useEffect(() => subscribeMemoryChanges((changed) => {
		if (changed === scope) invalidateMemoryQueries(qc, scope);
	}), [qc, scope]);
}

/** Imperative memory API. `scope` is required outside of hooks. */
export const memory = {
	get: <T>(scope: string, key: string) => backend.memoryGet(scope, key, currentArtifactId()) as Promise<T | undefined>,
	set: (scope: string, key: string, value: unknown) => {
		let snapshot: unknown;
		try {
			snapshot = jsonMemoryValue(value);
		} catch (error) {
			return Promise.reject(error);
		}
		return serializeMemoryWrite(scope, key, () => backend.memorySet(scope, key, snapshot));
	},
	delete: (scope: string, key: string) =>
		serializeMemoryWrite(scope, key, () => backend.memoryDelete(scope, key)),
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
): [T, (next: T | undefined | ((prev: T) => T | undefined)) => void, { loading: boolean; error: unknown }] {
	const scope = useScope(options.scope);
	const caller = useContext(ArtifactContext)?.id;
	useMemoryUpdates(scope);
	const qc = useQueryClient();
	const queryKey = useMemo(() => memoryKey(scope, key, caller), [scope, key, caller]);
	const [writeErrors, setWriteErrors] = useState<Map<string, unknown>>(() => new Map());
	// `initial` is only a default; keep the latest without re-creating callbacks on every render.
	const initialRef = useRef(initial);
	initialRef.current = initial;
	const readValue = useCallback(async () => {
		const value = await backend.memoryGet(scope, key, caller) as T | undefined;
		return value === undefined ? { found: false as const } : { found: true as const, value };
	}, [scope, key, caller]);
	const query = useQuery({
		queryKey,
		queryFn: readValue,
	});
	const { mutate } = useMutation({
		mutationFn: ({ scope: targetScope, key: targetKey, caller: targetCaller, initial: actionInitial, value, expected, update }: MemoryWrite<T>) => {
			if (!update) return memory.set(targetScope, targetKey, value);
			return serializeMemoryWrite(targetScope, targetKey, async () => {
				let candidate = expected;
				let nextValue = value;
				for (let attempt = 0; attempt < 16; attempt++) {
					if (await backend.memoryCompareSet(targetScope, targetKey, candidate, nextValue)) return;
					const latest = await backend.memoryGet(targetScope, targetKey, targetCaller) as T | undefined;
					candidate = latest === undefined ? { found: false } : { found: true, value: JSON.parse(JSON.stringify(latest)) };
					nextValue = jsonMemoryValue(update(latest === undefined ? actionInitial : latest));
				}
				throw new Error("Memory update conflicted repeatedly; retry the action");
			});
		},
		onError: (error, operation) => {
			setWriteErrors((previous) => new Map(previous).set(`${operation.scope}\u0000${operation.key}`, error));
			invalidateMemoryQueries(qc, operation.scope);
		},
	});
	const set = useCallback(
		(next: T | undefined | ((prev: T) => T | undefined)) => {
			setWriteErrors((previous) => {
				const id = `${scope}\u0000${key}`;
				if (!previous.has(id)) return previous;
				const nextErrors = new Map(previous);
				nextErrors.delete(id);
				return nextErrors;
			});
			const apply = () => {
				const cached = qc.getQueryData<MemoryCache<T>>(queryKey);
				let expected: MemorySnapshot;
				try { expected = cached?.found ? { found: true, value: jsonMemoryValue(cached.value) } : { found: false }; }
				catch (error) { setWriteErrors((previous) => new Map(previous).set(`${scope}\u0000${key}`, error)); return; }
				const update = typeof next === "function" ? next as (p: T) => T | undefined : undefined;
				let value: T | undefined;
				// An updater must not be able to mutate either the cached value or the
				// compare-and-set snapshot before its result has been validated.
				try {
					const prev = update && expected.found ? jsonMemoryValue(expected.value) as T : initialRef.current;
					value = jsonMemoryValue(update ? update(prev) : next as T | undefined);
				}
				catch (error) { setWriteErrors((previous) => new Map(previous).set(`${scope}\u0000${key}`, error)); return; }
				// A read still in flight (e.g. a focus refetch) must not undo this write.
				void qc.cancelQueries({ queryKey });
				// Setting undefined deletes the key; the hook then shows `initial` again.
				const nextCache: MemoryCache<T> = value === undefined ? { found: false } : { found: true, value };
				qc.setQueryData<MemoryCache<T>>(queryKey, () => nextCache);
				mutate({ scope, key, caller, initial: initialRef.current, value, expected, update });
			};
			if (typeof next === "function" && qc.getQueryData(queryKey) === undefined && qc.getQueryState(queryKey)?.status !== "success") {
				// A functional update needs the persisted value, not the temporary initial value.
				void qc.fetchQuery({ queryKey, queryFn: readValue }).then(apply, () => {});
				return;
			}
			apply();
		},
		[qc, queryKey, mutate, readValue, scope, key, caller],
	);
	return [(query.data?.found ? query.data.value : initial) as T, set, { loading: query.isPending, error: query.error ?? writeErrors.get(`${scope}\u0000${key}`) }];
}

/** Every entry of a scope (optionally under a key prefix). */
export function useMemoryList(options: MemoryOptions & { prefix?: string } = {}) {
	const scope = useScope(options.scope);
	const caller = useContext(ArtifactContext)?.id;
	useMemoryUpdates(scope);
	return useQuery({
		queryKey: ["pi-memory-list", scope, options.prefix ?? "", scope === SHARED_SCOPE ? caller : undefined],
		queryFn: () => backend.memoryList(scope, options.prefix, caller),
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
async function callMcpFor<T>(artifactId: string, name: string, args: Record<string, unknown>) {
	const result = await backend.mcpCall(normalizeMcpToolName(name), args, artifactId);
	if (result.isError) throw new Error(result.text || `MCP tool ${name} failed`);
	return { ...result, data: result.data as T };
}

export async function callMcp<T = unknown>(name: string, args: Record<string, unknown> = {}) {
	const artifactId = currentArtifactId();
	if (!artifactId) throw new Error("callMcp() must be used inside an artifact");
	return callMcpFor<T>(artifactId, name, args);
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
	const artifact = useContext(ArtifactContext);
	if (!artifact) throw new Error("useMcp() must be used inside an artifact");
	return useQuery({
		queryKey: ["pi-mcp", artifact.id, artifact.instanceId ?? null, artifact.updatedAt ?? null, artifact.mcp ?? [], normalizeMcpToolName(name), args],
		queryFn: () => callMcpFor<T>(artifact.id, name, args),
		staleTime: 60_000,
		// An error can occur after the tool acted, so automatic repeats are unsafe by default.
		retry: false,
		retryOnMount: false,
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		...options,
	});
}

/** Run an MCP tool on demand (buttons, forms). */
export function useMcpMutation<T = unknown>(name: string) {
	const artifact = useContext(ArtifactContext);
	if (!artifact) throw new Error("useMcpMutation() must be used inside an artifact");
	return useMutation({ mutationFn: (args: Record<string, unknown> = {}) => callMcpFor<T>(artifact.id, name, args) });
}
