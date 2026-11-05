import { createFileRoute } from "@tanstack/react-router";
import { ErrorPanel } from "@/components/artifact-error";
import { ArtifactView } from "@/components/artifact-view";
import { getTemplatePreviewFn } from "@/server/fns";

/** Preview of a template, rendered like an artifact (memory scope `template-<name>`). */
export const Route = createFileRoute("/t/$name")({
	ssr: false,
	loader: ({ params }) => getTemplatePreviewFn({ data: params.name }),
	component: () => <ArtifactView data={Route.useLoaderData()} kind="template" />,
	errorComponent: ({ error }) => (
		<div className="p-8">
			<ErrorPanel title="Could not load the template" error={error} />
		</div>
	),
});
