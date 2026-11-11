import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Code2, Database, Eye } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { ArtifactErrorBoundary, ErrorPanel } from "@/components/artifact-error";
import { ExportButton } from "@/components/export-button";
import { McpBadge } from "@/components/mcp-badge";
import { MemoryTable } from "@/components/memory-table";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MEMORY_CHANGED_EVENT } from "@/lib/events";
import { timeAgo } from "@/lib/format";
import { useArtifactModule } from "@/lib/use-artifact-module";
import { ArtifactContext, setCurrentArtifact } from "@/sdk/context";
import { invalidateMemoryQueries } from "@/sdk/memory-sync";
import { getCodeFn, pingFn, reportErrorFn } from "@/server/fns";

interface ArtifactViewData {
	id: string;
	instanceId?: string;
	title: string;
	description?: string;
	mcp: string[];
	updatedAt: number;
	moduleUrl: string;
}

function report(id: string, error: unknown) {
	const e = error instanceof Error ? error : new Error(String(error));
	void reportErrorFn({ data: { id, message: e.message, stack: e.stack } }).catch(() => {});
}

/**
 * Tell the daemon this artifact is open (so artifact_write waits for runtime errors) and
 * forward uncaught errors, so the agent learns about crashes it cannot see.
 */
function useRuntimeFeedback(id: string) {
	const qc = useQueryClient();
	useEffect(() => {
		const hot = import.meta.hot;
		if (!hot) return;
		const onMemory = (data: { scope: string }) => {
			invalidateMemoryQueries(qc, data.scope);
		};
		hot.on(MEMORY_CHANGED_EVENT, onMemory);
		return () => hot.off(MEMORY_CHANGED_EVENT, onMemory);
	}, [qc]);
	useEffect(() => {
		setCurrentArtifact(id);
		// Ping even when the tab is in the background (behind the terminal is the usual case).
		const ping = () => void pingFn({ data: id }).catch(() => {});
		ping();
		const timer = setInterval(ping, 8000);
		document.addEventListener("visibilitychange", ping);
		import.meta.hot?.on("vite:beforeUpdate", ping);
		const onError = (e: ErrorEvent) => report(id, e.error ?? e.message);
		const onRejection = (e: PromiseRejectionEvent) => report(id, e.reason);
		window.addEventListener("error", onError);
		window.addEventListener("unhandledrejection", onRejection);
		return () => {
			setCurrentArtifact(undefined);
			clearInterval(timer);
			document.removeEventListener("visibilitychange", ping);
			import.meta.hot?.off("vite:beforeUpdate", ping);
			window.removeEventListener("error", onError);
			window.removeEventListener("unhandledrejection", onRejection);
		};
	}, [id]);
}

/** The artifact page chrome (Preview / Code / Memory) around one artifact module. */
export function ArtifactView({ data, kind = "artifact" }: { data: ArtifactViewData; kind?: "artifact" | "template" }) {
	const [tab, setTab] = useState("preview");
	const loaded = useArtifactModule(data.moduleUrl, data.updatedAt);
	useRuntimeFeedback(data.id);
	useEffect(() => {
		if (loaded.status === "error") report(data.id, loaded.error);
	}, [loaded, data.id]);

	return (
		<ArtifactContext.Provider value={{ id: data.id, instanceId: data.instanceId, updatedAt: data.updatedAt, title: data.title, description: data.description, mcp: data.mcp }}>
			<Tabs value={tab} onValueChange={setTab} className="min-h-dvh gap-0">
				<header className="bg-background/80 sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b px-3 py-2 backdrop-blur">
					<Button variant="ghost" size="icon" asChild>
						<Link to="/" aria-label="All artifacts">
							<ArrowLeft />
						</Link>
					</Button>
					<div className="min-w-0">
						<h1 className="truncate text-sm font-semibold">{data.title}</h1>
						<p className="text-muted-foreground truncate text-xs">
							{kind === "template" ? "template preview" : `${data.id} · updated ${timeAgo(data.updatedAt)}`}
						</p>
					</div>
					{data.mcp.length > 0 && (
						<Badge variant="outline" className="hidden md:inline-flex" title={`MCP allowlist: ${data.mcp.join(", ")}`}>
							MCP {data.mcp.length}
						</Badge>
					)}
					<TabsList className="ml-auto">
						<TabsTrigger value="preview">
							<Eye /> <span className="sr-only sm:not-sr-only">Preview</span>
						</TabsTrigger>
						<TabsTrigger value="code">
							<Code2 /> <span className="sr-only sm:not-sr-only">Code</span>
						</TabsTrigger>
						<TabsTrigger value="memory">
							<Database /> <span className="sr-only sm:not-sr-only">Memory</span>
						</TabsTrigger>
					</TabsList>
					{kind === "artifact" && <ExportButton id={data.id} />}
					<McpBadge />
					<ThemeToggle />
				</header>

				<TabsContent value="preview" className="p-4 sm:p-6">
					{loaded.status === "loading" && <PreviewSkeleton />}
					{loaded.status === "error" && <ErrorPanel title="The artifact failed to load" error={loaded.error} />}
					{loaded.status === "ready" && (
						<ArtifactErrorBoundary resetKey={loaded.revision} onError={(e) => report(data.id, e)}>
							<Suspense fallback={<PreviewSkeleton />}>
								<loaded.Component />
							</Suspense>
						</ArtifactErrorBoundary>
					)}
				</TabsContent>
				<TabsContent value="code" className="p-4 sm:p-6">
					<CodeView moduleUrl={data.moduleUrl} version={data.updatedAt} />
				</TabsContent>
				<TabsContent value="memory" className="mx-auto w-full max-w-5xl p-4 sm:p-6">
					<MemoryTable scope={data.id} />
				</TabsContent>
			</Tabs>
		</ArtifactContext.Provider>
	);
}

function CodeView({ moduleUrl, version }: { moduleUrl: string; version: number }) {
	const { data, isPending, error, refetch } = useQuery({
		queryKey: ["artifact-code", moduleUrl, version],
		queryFn: () => getCodeFn({ data: { moduleUrl } }),
	});
	if (isPending) return <Skeleton className="h-96 w-full" />;
	if (error) return <ErrorPanel title="Could not read the source" error={error} onRetry={() => void refetch()} />;
	return (
		<pre role="region" aria-label="Artifact source code" tabIndex={0} className="bg-muted focus-visible:ring-ring overflow-x-auto rounded-lg border p-4 font-mono text-xs leading-relaxed focus-visible:ring-2 focus-visible:outline-none">
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
