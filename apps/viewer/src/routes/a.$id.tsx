import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Code2, Database, Eye } from "lucide-react";
import { type ComponentType, Suspense, useCallback, useEffect, useState } from "react";
import { ArtifactErrorBoundary, ErrorPanel } from "@/components/artifact-error";
import { McpBadge } from "@/components/mcp-badge";
import { MemoryTable } from "@/components/memory-table";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { timeAgo } from "@/lib/format";
import { useArtifactsChanged } from "@/lib/hmr";
import { ArtifactContext } from "@/sdk/context";
import { getArtifactCodeFn, getArtifactFn } from "@/server/fns";

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

type Loaded = { status: "loading" } | { status: "ready"; Component: ComponentType } | { status: "error"; error: unknown };

function useArtifactModule(url: string, version: number): Loaded {
	const [state, setState] = useState<Loaded>({ status: "loading" });
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let cancelled = false;
		// First load uses the plain URL so Vite HMR / Fast Refresh tracks it; a retry
		// after a failed import needs a fresh URL because the browser caches failures.
		const src = attempt === 0 ? url : `${url}?t=${version}-${attempt}`;
		import(/* @vite-ignore */ src).then(
			(mod) => {
				if (cancelled) return;
				const Component = mod.default;
				if (typeof Component !== "function") {
					setState({ status: "error", error: new Error("The artifact must `export default` a React component") });
				} else {
					setState({ status: "ready", Component });
				}
			},
			(error) => !cancelled && setState({ status: "error", error }),
		);
		return () => {
			cancelled = true;
		};
	}, [url, attempt, version]);
	// Retry when a new version arrives after a failed import.
	useEffect(() => {
		if (state.status === "error") setAttempt((n) => n + 1);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [version]);
	return state;
}

function ArtifactPage() {
	const meta = Route.useLoaderData();
	const router = useRouter();
	const [tab, setTab] = useState("preview");
	useArtifactsChanged(useCallback((id) => id === meta.id && router.invalidate(), [meta.id, router]));
	const loaded = useArtifactModule(meta.moduleUrl, meta.updatedAt);

	return (
		<ArtifactContext.Provider value={{ id: meta.id, title: meta.title, description: meta.description }}>
			<Tabs value={tab} onValueChange={setTab} className="min-h-dvh gap-0">
				<header className="bg-background/80 sticky top-0 z-40 flex items-center gap-2 border-b px-3 py-2 backdrop-blur">
					<Button variant="ghost" size="icon" asChild>
						<Link to="/" aria-label="All artifacts">
							<ArrowLeft />
						</Link>
					</Button>
					<div className="min-w-0">
						<h1 className="truncate text-sm font-semibold">{meta.title}</h1>
						<p className="text-muted-foreground truncate text-xs">
							{meta.id} · updated {timeAgo(meta.updatedAt)}
						</p>
					</div>
					<TabsList className="ml-auto">
						<TabsTrigger value="preview">
							<Eye /> <span className="hidden sm:inline">Preview</span>
						</TabsTrigger>
						<TabsTrigger value="code">
							<Code2 /> <span className="hidden sm:inline">Code</span>
						</TabsTrigger>
						<TabsTrigger value="memory">
							<Database /> <span className="hidden sm:inline">Memory</span>
						</TabsTrigger>
					</TabsList>
					<McpBadge />
					<ThemeToggle />
				</header>

				<TabsContent value="preview" className="p-4 sm:p-6">
					{loaded.status === "loading" && <PreviewSkeleton />}
					{loaded.status === "error" && <ErrorPanel title="The artifact failed to load" error={loaded.error} />}
					{loaded.status === "ready" && (
						<ArtifactErrorBoundary resetKey={meta.updatedAt}>
							<Suspense fallback={<PreviewSkeleton />}>
								<loaded.Component />
							</Suspense>
						</ArtifactErrorBoundary>
					)}
				</TabsContent>
				<TabsContent value="code" className="p-4 sm:p-6">
					<CodeView id={meta.id} version={meta.updatedAt} />
				</TabsContent>
				<TabsContent value="memory" className="mx-auto w-full max-w-5xl p-4 sm:p-6">
					<MemoryTable scope={meta.id} />
				</TabsContent>
			</Tabs>
		</ArtifactContext.Provider>
	);
}

function CodeView({ id, version }: { id: string; version: number }) {
	const { data, isPending } = useQuery({
		queryKey: ["artifact-code", id, version],
		queryFn: () => getArtifactCodeFn({ data: id }),
	});
	if (isPending) return <Skeleton className="h-96 w-full" />;
	return (
		<pre className="bg-muted overflow-x-auto rounded-lg border p-4 font-mono text-xs leading-relaxed">
			<code>{data}</code>
		</pre>
	);
}

function PreviewSkeleton() {
	return (
		<div className="mx-auto max-w-4xl space-y-4">
			<Skeleton className="h-8 w-1/3" />
			<Skeleton className="h-40 w-full" />
			<Skeleton className="h-40 w-full" />
		</div>
	);
}
