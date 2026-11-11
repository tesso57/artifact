import { createContext, useContext } from "react";

export interface ArtifactInfo {
	id: string;
	instanceId?: string;
	/** Revision of the artifact source, used to refresh version-specific queries. */
	updatedAt?: number;
	title: string;
	description?: string;
	/** MCP tools allowed for this version of the artifact, when running in the viewer. */
	mcp?: readonly string[];
}

export const ArtifactContext = createContext<ArtifactInfo | null>(null);

/** The artifact being rendered. */
export function useArtifact(): ArtifactInfo {
	const info = useContext(ArtifactContext);
	if (!info) throw new Error("useArtifact() must be used inside an artifact");
	return info;
}

// One artifact is mounted per page; the imperative APIs (memory.*, callMcp) use it as caller.
let current: string | undefined;

/** Set by the page that mounts an artifact. */
export function setCurrentArtifact(id: string | undefined): void {
	current = id;
}

export function currentArtifactId(): string | undefined {
	return current;
}
