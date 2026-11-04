import { RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Destructive alert with an optional retry button. */
export function ErrorState({ error, title = "Something went wrong", onRetry, className }: { error: unknown; title?: string; onRetry?: () => void; className?: string }) {
	return (
		<Alert variant="destructive" className={className}>
			<TriangleAlert />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>
				<p className="break-words">{errorMessage(error)}</p>
				{onRetry && (
					<Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
						<RefreshCw /> Retry
					</Button>
				)}
			</AlertDescription>
		</Alert>
	);
}

/** Muted placeholder for "nothing here yet". */
export function EmptyState({ title = "Nothing here yet", description, icon, action, className }: { title?: string; description?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
	return (
		<div className={cn("flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center", className)}>
			{icon && <div className="text-muted-foreground [&_svg]:size-6">{icon}</div>}
			<p className="font-medium">{title}</p>
			{description && <p className="text-muted-foreground max-w-sm text-sm">{description}</p>}
			{action}
		</div>
	);
}

/** Default loading placeholder: a few skeleton lines. */
export function LoadingState({ lines = 3, className }: { lines?: number; className?: string }) {
	return (
		<div className={cn("space-y-2", className)} aria-busy>
			{Array.from({ length: lines }, (_, i) => (
				<Skeleton key={i} className={cn("h-6", i === lines - 1 ? "w-2/3" : "w-full")} />
			))}
		</div>
	);
}

const defaultIsEmpty = (data: unknown) =>
	data == null || (Array.isArray(data) && data.length === 0) || (typeof data === "object" && !Array.isArray(data) && Object.keys(data as object).length === 0);

/**
 * Render a TanStack Query result with consistent shadcn loading / error / empty states.
 *
 *   <QueryState query={useQuery(...)}>{(rows) => <List rows={rows} />}</QueryState>
 */
export function QueryState<T>({
	query,
	children,
	loading,
	empty,
	isEmpty = defaultIsEmpty,
	errorTitle,
}: {
	/** A `useQuery` result (or anything with the same fields). */
	query: { data: T | undefined; error: unknown; isPending: boolean; refetch: () => unknown };
	children: (data: T) => ReactNode;
	loading?: ReactNode;
	empty?: ReactNode;
	isEmpty?: (data: T) => boolean;
	errorTitle?: string;
}) {
	if (query.isPending) return <>{loading ?? <LoadingState />}</>;
	if (query.error) return <ErrorState error={query.error} title={errorTitle} onRetry={() => query.refetch()} />;
	const data = query.data as T;
	if (isEmpty(data)) return <>{empty ?? <EmptyState />}</>;
	return <>{children(data)}</>;
}

/** Inline error for a mutation (form submit, button action), or nothing. */
export function MutationError({ mutation, title = "Action failed" }: { mutation: { error: unknown; reset: () => void }; title?: string }) {
	if (!mutation.error) return null;
	return <ErrorState error={mutation.error} title={title} onRetry={() => mutation.reset()} />;
}
