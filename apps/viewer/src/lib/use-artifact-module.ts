import { type ComponentType, useEffect, useState } from "react";

type LoadedArtifact =
	| { status: "loading" }
	| { status: "ready"; Component: ComponentType }
	| { status: "error"; error: unknown };

/**
 * Import an artifact module from the Vite dev server.
 *
 * The first load uses the plain URL so Vite HMR / React Fast Refresh tracks the module.
 * Browsers cache failed imports, so after a failure a new `version` retries with a fresh URL.
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
		const src = attempt === 0 ? url : `${url}?t=${attempt}`;
		import(/* @vite-ignore */ src).then(
			(mod) => {
				if (cancelled) return;
				const Component = mod.default;
				setState(
					typeof Component === "function"
						? { status: "ready", Component }
						: { status: "error", error: new Error("The artifact must `export default` a React component") },
				);
			},
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

	return state;
}
