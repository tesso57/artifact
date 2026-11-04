import { createContext, useContext } from "react";

export interface ArtifactInfo {
	id: string;
	title: string;
	description?: string;
}

export const ArtifactContext = createContext<ArtifactInfo | null>(null);

/** The artifact being rendered. */
export function useArtifact(): ArtifactInfo {
	const info = useContext(ArtifactContext);
	if (!info) throw new Error("useArtifact() must be used inside an artifact");
	return info;
}
