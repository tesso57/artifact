import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { RouteError } from "@/components/route-error";
import { ArtifactView } from "@/components/artifact-view";
import { getTemplatePreviewFn } from "@/server/fns";
import { TEMPLATE_CHANGED_EVENT } from "@/lib/events";

/** Preview of a template, rendered like an artifact (memory scope `template-<name>`). */
export const Route = createFileRoute("/t/$name")({
	ssr: false,
	loader: ({ params }) => getTemplatePreviewFn({ data: params.name }),
	component: TemplatePage,
	errorComponent: ({ error }) => <RouteError title="Could not load the template" error={error} />,
});

function TemplatePage() {
	const data = Route.useLoaderData();
	const router = useRouter();
	useEffect(() => {
		const hot = import.meta.hot;
		if (!hot) return;
		const changed = ({ name }: { name: string }) => { if (data.id === `template-${name}`) void router.invalidate(); };
		hot.on(TEMPLATE_CHANGED_EVENT, changed);
		return () => hot.off(TEMPLATE_CHANGED_EVENT, changed);
	}, [data.id, router]);
	return <ArtifactView key={data.id} data={data} kind="template" />;
}
