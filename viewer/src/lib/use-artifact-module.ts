import { type ComponentType, useEffect, useState } from "react";

type LoadedArtifact =
	| { status: "loading" }
	| { status: "ready"; Component: ComponentType }
	| { status: "error"; error: unknown };

/** A React component: a function, or a memo/forwardRef/lazy object. */
const isComponent = (c: unknown) => typeof c === "function" || (typeof c === "object" && c !== null && "$$typeof" in c);

function toLoaded(mod: { default?: unknown }): LoadedArtifact {
	return isComponent(mod.default)
		? { status: "ready", Component: mod.default as ComponentType }
		: { status: "error", error: new Error("The artifact must `export default` a React component") };
}

/**
 * Import an artifact module from the Vite dev server and keep it current.
 *
 * - The first load uses the plain URL so Vite HMR tracks the module.
 * - React Fast Refresh swaps a component in place only when its name stays the same; when
 *   a hot update renames the default export (common when the agent rewrites an artifact),
 *   the new module is re-imported and its component mounted instead.
 * - Browsers cache failed imports, so after a failure a new `version` retries with a fresh URL.
 */
export function useArtifactModule(url: string, version: number): LoadedArtifact {
	const [state, setState] = useState<LoadedArtifact>({ status: "loading" });
	const [attempt, setAttempt] = useState(0);
	const [failedVersion, setFailedVersion] = useState<number | null>(null);

	// A new version after a failed import: retry.
	if (failedVersion !== null && failedVersion !== version) {
		setFailedVersion(null);
		setAttempt((n) => n + 1);
	}

	useEffect(() => {
		let cancelled = false;
		const src = attempt === 0 ? url : `${url}?t=${attempt}-${Date.now()}`;
		import(/* @vite-ignore */ src).then(
			(mod) => !cancelled && setState(toLoaded(mod)),
			(error) => {
				if (cancelled) return;
				setState({ status: "error", error });
				setFailedVersion(version);
			},
		);
		return () => {
			cancelled = true;
		};
		// `version` is read only when a load fails; retries are driven by `attempt`.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [url, attempt]);

	useEffect(() => {
		const hot = import.meta.hot;
		if (!hot) return;
		const onUpdate = (payload: { updates: { path: string; timestamp: number }[] }) => {
			const update = payload.updates.find((u) => u.path === url);
			if (!update) return;
			// Same URL + timestamp as Vite's own hot import: returns the already-updated module.
			import(/* @vite-ignore */ `${url}?t=${update.timestamp}`).then(
				(mod) =>
					setState((prev) => {
						const next = toLoaded(mod);
						// Fast Refresh swaps named components in place (keeping state); anonymous ones are
						// not registered with it, and renamed ones are new components: mount those.
						const named = (c: unknown) => typeof c === "function" && !!c.name && c.name !== "default";
						const sameName =
							prev.status === "ready" && next.status === "ready" && named(next.Component) && (prev.Component as { name?: string }).name === (next.Component as { name?: string }).name;
						return sameName ? prev : next;
					}),
				(error) => setState({ status: "error", error }),
			);
		};
		hot.on("vite:afterUpdate", onUpdate);
		return () => hot.off("vite:afterUpdate", onUpdate);
	}, [url]);

	return state;
}
