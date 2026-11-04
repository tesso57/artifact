import { useEffect } from "react";
import { ARTIFACTS_CHANGED_EVENT } from "./events";

/** Run `fn` whenever an artifact is added, updated or removed (dev server event). */
export function useArtifactsChanged(fn: (id: string) => void) {
	useEffect(() => {
		const hot = import.meta.hot;
		if (!hot) return;
		const handler = (data: { id: string }) => fn(data.id);
		hot.on(ARTIFACTS_CHANGED_EVENT, handler);
		return () => hot.off(ARTIFACTS_CHANGED_EVENT, handler);
	}, [fn]);
}
