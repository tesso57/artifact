/** Entry of exported HTML files: mounts one artifact without the viewer chrome. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { ArtifactErrorBoundary } from "@/components/artifact-error";
import { ArtifactContext, setCurrentArtifact } from "@/sdk/context";
import type {} from "./snapshot";
import "@/styles.css";

export function mount(Artifact: ComponentType) {
	const snap = window.__PI_ARTIFACT__;
	const info = snap?.artifact ?? { id: "artifact", title: "Artifact" };
	setCurrentArtifact(info.id);
	try {
		const dark = matchMedia("(prefers-color-scheme: dark)").matches;
		document.documentElement.classList.toggle("dark", dark);
	} catch {}
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
	createRoot(document.getElementById("root")!).render(
		<QueryClientProvider client={queryClient}>
			<ArtifactContext.Provider value={info}>
				<main className="min-h-dvh p-4 sm:p-6">
					<ArtifactErrorBoundary resetKey={0}>
						<Artifact />
					</ArtifactErrorBoundary>
				</main>
			</ArtifactContext.Provider>
		</QueryClientProvider>,
	);
}
