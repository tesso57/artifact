import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { FileCode2, Folder, Search, Sparkles } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { McpBadge } from "@/components/mcp-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { timeAgo } from "@/lib/format";
import { useArtifactsChanged } from "@/lib/hmr";
import { listArtifactsFn } from "@/server/fns";

export const Route = createFileRoute("/")({
	loader: () => listArtifactsFn(),
	component: Home,
});

function Home() {
	const artifacts = Route.useLoaderData();
	const router = useRouter();
	const [q, setQ] = useState("");
	useArtifactsChanged(useCallback(() => router.invalidate(), [router]));

	const filtered = useMemo(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return artifacts;
		return artifacts.filter((a) =>
			[a.id, a.title, a.description ?? "", a.cwd ?? ""].some((s) => s.toLowerCase().includes(needle)),
		);
	}, [artifacts, q]);

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
			<header className="mb-8 flex flex-wrap items-center gap-3">
				<div className="flex items-center gap-2">
					<div className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg">
						<Sparkles className="size-4" />
					</div>
					<h1 className="text-xl font-semibold tracking-tight">pi artifacts</h1>
				</div>
				<Badge variant="secondary">{artifacts.length}</Badge>
				<div className="ml-auto flex items-center gap-2">
					<McpBadge />
					<ThemeToggle />
				</div>
			</header>

			<div className="relative mb-6 max-w-md">
				<Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
				<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search artifacts…" className="pl-9" />
			</div>

			{artifacts.length === 0 ? (
				<EmptyState />
			) : filtered.length === 0 ? (
				<p className="text-muted-foreground text-sm">No artifacts match “{q}”.</p>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{filtered.map((a) => (
						<Link key={a.id} to="/a/$id" params={{ id: a.id }} className="group">
							<Card className="group-hover:border-ring h-full gap-4 transition-colors">
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<FileCode2 className="text-muted-foreground size-4" />
										<span className="truncate">{a.title}</span>
									</CardTitle>
									<CardDescription className="line-clamp-2 min-h-10">{a.description || a.id}</CardDescription>
								</CardHeader>
								<CardFooter className="text-muted-foreground mt-auto gap-2 text-xs">
									<span>{timeAgo(a.updatedAt)}</span>
									{a.cwd && (
										<span className="ml-auto flex min-w-0 items-center gap-1" title={a.cwd}>
											<Folder className="size-3 shrink-0" />
											<span className="truncate">{a.cwd.split("/").pop()}</span>
										</span>
									)}
								</CardFooter>
							</Card>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}

function EmptyState() {
	return (
		<Card className="items-center border-dashed py-16 text-center">
			<Sparkles className="text-muted-foreground size-8" />
			<div className="space-y-1">
				<p className="font-medium">No artifacts yet</p>
				<p className="text-muted-foreground text-sm">Ask pi to build something — “make me a dashboard of …”.</p>
			</div>
		</Card>
	);
}
