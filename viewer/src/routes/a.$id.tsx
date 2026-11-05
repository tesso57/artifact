import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { ErrorPanel } from "@/components/artifact-error";
import { ArtifactView } from "@/components/artifact-view";
import { useArtifactsChanged } from "@/lib/hmr";
import { getArtifactFn } from "@/server/fns";

export const Route = createFileRoute("/a/$id")({
	// Artifacts are client components (they use browser APIs freely); skip SSR.
	ssr: false,
	loader: ({ params }) => getArtifactFn({ data: params.id }),
	component: ArtifactPage,
	errorComponent: ({ error }) => (
		<div className="p-8">
			<ErrorPanel title="Could not load the artifact" error={error} />
		</div>
	),
});

function ArtifactPage() {
	const data = Route.useLoaderData();
	const router = useRouter();
	useArtifactsChanged(useCallback((id) => id === data.id && router.invalidate(), [data.id, router]));
	return <ArtifactView data={data} />;
}
