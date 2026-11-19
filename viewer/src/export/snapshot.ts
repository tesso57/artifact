import type { McpCallResult } from "../../../shared/protocol.ts";

export interface ArtifactSnapshot {
	artifact: { id: string; title: string; description?: string };
	exportedAt: number;
	snapshotId?: string;
	memory: { scope: string; key: string; value: unknown; updatedAt: number }[];
	mcp: Record<string, McpCallResult>;
}

declare global {
	interface Window {
		__PI_ARTIFACT__?: ArtifactSnapshot;
	}
}
