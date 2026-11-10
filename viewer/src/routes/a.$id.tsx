import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { RouteError } from "@/components/route-error";
import { ArtifactView } from "@/components/artifact-view";
import { useArtifactsChanged } from "@/lib/hmr";
import { getArtifactFn } from "@/server/fns";

export const Route = createFileRoute("/a/$id")({
	// Artifacts are client components (they use browser APIs freely); skip SSR.
	ssr: false,
	loader: ({ params }) => getArtifactFn({ data: params.id }),
	component: ArtifactPage,
	errorComponent: ({ error }) => <RouteError title="Could not load the artifact" error={error} />,
});

function ArtifactPage() {
	const data = Route.useLoaderData();
	const router = useRouter();
	useArtifactsChanged(useCallback((id) => id === data.id && router.invalidate(), [data.id, router]));
	return <ArtifactView key={`${data.id}:${data.instanceId ?? ""}`} data={data} />;
}
