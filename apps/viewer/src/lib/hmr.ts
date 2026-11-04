import { useEffect } from "react";

/** Run `fn` whenever an artifact is added, updated or removed (dev server event). */
export function useArtifactsChanged(fn: (id: string) => void) {
	useEffect(() => {
		const hot = import.meta.hot;
		if (!hot) return;
		const handler = (data: { id: string }) => fn(data.id);
		hot.on("pi-artifacts:changed", handler);
		return () => hot.off("pi-artifacts:changed", handler);
	}, [fn]);
}
