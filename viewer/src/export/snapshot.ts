import type { McpCallResult } from "../../../shared/protocol.ts";

/** Data embedded in an exported HTML file as `window.__PI_ARTIFACT__`. */
export interface ArtifactSnapshot {
	artifact: { id: string; title: string; description?: string };
	exportedAt: number;
	/** Unique per export; older files use exportedAt as their storage identity. */
	snapshotId?: string;
	/** The artifact's memory and the shared keys it read, at export time. */
	memory: { scope: string; key: string; value: unknown; updatedAt: number }[];
	/** Latest MCP results by `mcpCallKey(name, args)`. */
	mcp: Record<string, McpCallResult>;
}

declare global {
	interface Window {
		__PI_ARTIFACT__?: ArtifactSnapshot;
	}
}
