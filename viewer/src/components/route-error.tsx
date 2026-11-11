import { Link, useRouter } from "@tanstack/react-router";
import { ErrorPanel } from "@/components/artifact-error";
import { Button } from "@/components/ui/button";

export function RouteError({ title, error }: { title: string; error: unknown }) {
	const router = useRouter();
	return (
		<div className="mx-auto max-w-3xl space-y-4 p-8">
			<Button variant="outline" asChild><Link to="/">All artifacts</Link></Button>
			<ErrorPanel title={title} error={error} onRetry={() => void router.invalidate()} />
		</div>
	);
}
