/**
 * What the SDK talks to. In the viewer this is the TanStack Start server functions;
 * a single-file export swaps in `src/export/static-backend.ts` (same interface).
 */
import {
	mcpCallFn,
	mcpListToolsFn,
	mcpStatusFn,
	memoryDeleteFn,
	memoryCompareSetFn,
	memoryGetFn,
	memoryListFn,
	memorySetFn,
} from "@/server/fns";
import type { McpCallResult, McpToolInfo, MemorySnapshot } from "../../../shared/protocol.ts";

export interface MemoryRow {
	key: string;
	value: unknown;
	updatedAt: number;
}

export interface Backend {
	/** "live" in the viewer, "static" in an exported HTML file. */
	mode: "live" | "static";
	/** `from`: the calling artifact, so reads of "shared" can be embedded in its exports. */
	memoryGet(scope: string, key: string, from?: string): Promise<unknown>;
	memorySet(scope: string, key: string, value: unknown): Promise<void>;
	memoryCompareSet(scope: string, key: string, expected: MemorySnapshot, value: unknown): Promise<boolean>;
	memoryDelete(scope: string, key: string): Promise<boolean>;
	memoryList(scope: string, prefix?: string, from?: string): Promise<MemoryRow[]>;
	mcpStatus(): Promise<{ connected: boolean; ready?: boolean }>;
	mcpTools(): Promise<McpToolInfo[]>;
	mcpCall(name: string, args: Record<string, unknown>, artifactId: string): Promise<McpCallResult>;
}

async function memoryWrite<T>(run: () => Promise<T>): Promise<T> {
	try { return await run(); }
	catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Memory write failed or its response was lost; it may have completed. Refresh before retrying. ${detail}`, { cause: error });
	}
}

export const backend: Backend = {
	mode: "live",
	memoryGet: async (scope, key, from) => {
		const r = await memoryGetFn({ data: { scope, key, from } });
		return r.found ? r.value : undefined;
	},
	memorySet: async (scope, key, value) => {
		await memoryWrite(() => memorySetFn({ data: { scope, key, value } }));
	},
	memoryCompareSet: async (scope, key, expected, value) => (await memoryWrite(() => memoryCompareSetFn({ data: { scope, key, expected: expected as never, value: value as never } }))).updated,
	memoryDelete: async (scope, key) => (await memoryWrite(() => memoryDeleteFn({ data: { scope, key } }))).deleted,
	memoryList: (scope, prefix, from) => memoryListFn({ data: { scope, prefix, from } }),
	mcpStatus: () => mcpStatusFn(),
	mcpTools: () => mcpListToolsFn() as Promise<McpToolInfo[]>,
	mcpCall: (name, args, artifactId) => mcpCallFn({ data: { name, args, artifactId } }) as Promise<McpCallResult>,
};
