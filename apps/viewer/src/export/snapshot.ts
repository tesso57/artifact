import type { McpCallResult } from "@pi-artifacts/core/bridge";

/** Data embedded in an exported HTML file as `window.__PI_ARTIFACT__`. */
export interface ArtifactSnapshot {
	artifact: { id: string; title: string; description?: string };
	exportedAt: number;
	/** Memory of the artifact's scope and of "shared", at export time. */
	memory: { scope: string; key: string; value: unknown; updatedAt: number }[];
	/** Latest MCP results by `mcpCacheKey`. */
	mcp: Record<string, McpCallResult>;
}

declare global {
	interface Window {
		__PI_ARTIFACT__?: ArtifactSnapshot;
	}
}
