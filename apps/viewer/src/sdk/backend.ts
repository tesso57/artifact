/**
 * What the SDK talks to. In the viewer this is the TanStack Start server functions;
 * a single-file export swaps in `src/export/static-backend.ts` (same interface).
 */
import {
	mcpCallFn,
	mcpListToolsFn,
	mcpStatusFn,
	memoryDeleteFn,
	memoryGetFn,
	memoryListFn,
	memorySetFn,
} from "@/server/fns";
import type { McpCallResult, McpToolInfo } from "@pi-artifacts/core/bridge";

export interface MemoryRow {
	key: string;
	value: unknown;
	updatedAt: number;
}

export interface Backend {
	/** "live" in the viewer, "static" in an exported HTML file. */
	mode: "live" | "static";
	memoryGet(scope: string, key: string): Promise<unknown>;
	memorySet(scope: string, key: string, value: unknown): Promise<void>;
	memoryDelete(scope: string, key: string): Promise<boolean>;
	memoryList(scope: string, prefix?: string): Promise<MemoryRow[]>;
	mcpStatus(): Promise<{ connected: boolean; ready: boolean }>;
	mcpTools(): Promise<McpToolInfo[]>;
	mcpCall(name: string, args: Record<string, unknown>, artifactId?: string): Promise<McpCallResult>;
}

export const backend: Backend = {
	mode: "live",
	memoryGet: async (scope, key) => (await memoryGetFn({ data: { scope, key } })).value ?? undefined,
	memorySet: async (scope, key, value) => {
		await memorySetFn({ data: { scope, key, value } });
	},
	memoryDelete: async (scope, key) => (await memoryDeleteFn({ data: { scope, key } })).deleted,
	memoryList: (scope, prefix) => memoryListFn({ data: { scope, prefix } }),
	mcpStatus: () => mcpStatusFn(),
	mcpTools: () => mcpListToolsFn() as Promise<McpToolInfo[]>,
	mcpCall: (name, args, artifactId) => mcpCallFn({ data: { name, args, artifactId } }) as Promise<McpCallResult>,
};
