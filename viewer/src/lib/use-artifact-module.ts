import { type ComponentType, useEffect, useState } from "react";

type LoadedArtifact =
	| { status: "loading" }
	| { status: "ready"; Component: ComponentType; revision: number }
	| { status: "error"; error: unknown; sourceUrl?: string };

const isComponent = (c: unknown) => typeof c === "function" || (typeof c === "object" && c !== null && "$$typeof" in c);

function toLoaded(mod: { default?: unknown }, sourceUrl: string): LoadedArtifact {
	return isComponent(mod.default)
		? { status: "ready", Component: mod.default as ComponentType, revision: 0 }
		: { status: "error", error: new Error("The artifact must `export default` a React component"), sourceUrl };
}

export function useArtifactModule(url: string, version: number): LoadedArtifact {
	const [state, setState] = useState<LoadedArtifact>({ status: "loading" });
	const [attempt, setAttempt] = useState(0);
	const [failedVersion, setFailedVersion] = useState<number | null>(null);

	if (failedVersion !== null && failedVersion !== version) {
		setFailedVersion(null);
		setAttempt((n) => n + 1);
	}

	useEffect(() => {
		let cancelled = false;
		const src = attempt === 0 ? url : `${url}?t=${attempt}-${Date.now()}`;
		import(/* @vite-ignore */ src).then(
			(mod) => !cancelled && setState(toLoaded(mod, src)),
			(error) => {
				if (cancelled) return;
				setState({ status: "error", error });
				setFailedVersion(version);
			},
		);
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [url, attempt]);

	useEffect(() => {
		const hot = import.meta.hot;
		if (!hot) return;
		const onUpdate = (payload: { updates: { path: string; timestamp: number }[] }) => {
			const update = payload.updates.find((u) => u.path === url || u.path === decodeURI(url));
			if (!update) return;
			const src = `${url}?t=${update.timestamp}`;
			import(/* @vite-ignore */ src).then(
				(mod) =>
					setState((prev) => {
						const next = toLoaded(mod, src);
						const named = (c: unknown) => typeof c === "function" && !!c.name && c.name !== "default";
						const sameName =
							prev.status === "ready" && next.status === "ready" && named(next.Component) && (prev.Component as { name?: string }).name === (next.Component as { name?: string }).name;
						if (next.status !== "ready") return next;
						return { ...next, Component: sameName && prev.status === "ready" ? prev.Component : next.Component, revision: prev.status === "ready" ? prev.revision + 1 : 0 };
					}),
				(error) => setState({ status: "error", error }),
			);
		};
		hot.on("vite:afterUpdate", onUpdate);
		return () => hot.off("vite:afterUpdate", onUpdate);
	}, [url]);

	return state;
}
