import { createContext, useContext } from "react";

export interface ArtifactInfo {
	id: string;
	instanceId?: string;
	updatedAt?: number;
	title: string;
	description?: string;
	mcp?: readonly string[];
}

export const ArtifactContext = createContext<ArtifactInfo | null>(null);

export function useArtifact(): ArtifactInfo {
	const info = useContext(ArtifactContext);
	if (!info) throw new Error("useArtifact() must be used inside an artifact");
	return info;
}

let current: string | undefined;

export function setCurrentArtifact(id: string | undefined): void {
	current = id;
}

export function currentArtifactId(): string | undefined {
	return current;
}
