/**
 * Template: MCP-powered artifact — lists the MCP tools pi is connected to and
 * runs one with JSON arguments. Shows the loading / error / offline states every
 * MCP artifact needs. For a specific tool, prefer `useMcp("server.tool", args)`.
 * As an artifact it can only run the tools in its `mcp` allowlist (e.g. ["github.*"]).
 */
import { useMcpMutation, useMcpStatus, useMcpTools } from "@pi/artifact";
import { Play, PlugZap, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export default function McpExplorer() {
	const status = useMcpStatus();
	const tools = useMcpTools();
	const [filter, setFilter] = useState("");
	const [selected, setSelected] = useState<string>();
	const [args, setArgs] = useState("{}");
	const run = useMcpMutation(selected ?? "");

	const list = useMemo(
		() => (tools.data ?? []).filter((t) => `${t.server} ${t.tool} ${t.description}`.toLowerCase().includes(filter.toLowerCase())),
		[tools.data, filter],
	);
	const tool = tools.data?.find((t) => t.name === selected);
	let parsed: Record<string, unknown> | undefined;
	try {
		parsed = JSON.parse(args);
	} catch {}

	if (status.data && !status.data.connected) {
		return (
			<Alert className="mx-auto max-w-xl">
				<PlugZap />
				<AlertTitle>pi is not connected</AlertTitle>
				<AlertDescription>Open this artifact from pi (or re-run it there) to call MCP tools.</AlertDescription>
			</Alert>
		);
	}

	return (
		<div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[320px_1fr]">
			<Card className="gap-3">
				<CardHeader>
					<CardTitle>MCP tools</CardTitle>
					<CardDescription>{tools.data ? `${tools.data.length} available` : "Loading…"}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
					<div className="max-h-[60vh] space-y-1 overflow-y-auto">
						{tools.isPending && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
						{tools.error && <p className="text-destructive text-sm">{String(tools.error)}</p>}
						{list.map((t) => (
							<button
								key={t.name}
								type="button"
								onClick={() => { setSelected(t.name); setArgs("{}"); run.reset(); }}
								className={`hover:bg-muted w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${t.name === selected ? "bg-muted" : ""}`}
							>
								<div className="flex items-center gap-2">
									<Badge variant="outline">{t.server}</Badge>
									<span className="truncate font-medium">{t.tool}</span>
								</div>
								<p className="text-muted-foreground mt-1 line-clamp-1 text-xs">{t.description}</p>
							</button>
						))}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{tool ? `${tool.server}.${tool.tool}` : "Pick a tool"}</CardTitle>
					<CardDescription>{tool?.description ?? "Its input schema and result appear here."}</CardDescription>
				</CardHeader>
				{tool && (
					<CardContent className="space-y-4">
						<details className="text-sm">
							<summary className="text-muted-foreground cursor-pointer">Input schema</summary>
							<pre className="bg-muted mt-2 max-h-48 overflow-auto rounded-md p-3 text-xs">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
						</details>
						<Textarea value={args} onChange={(e) => setArgs(e.target.value)} className="font-mono text-xs" rows={5} aria-invalid={!parsed} />
						<Button disabled={!parsed || run.isPending} onClick={() => parsed && run.mutate(parsed)}>
							<Play /> {run.isPending ? "Running…" : "Run"}
						</Button>
						{run.error && (
							<Alert variant="destructive">
								<TriangleAlert />
								<AlertTitle>Tool failed</AlertTitle>
								<AlertDescription>{String(run.error.message)}</AlertDescription>
							</Alert>
						)}
						{run.data && (
							<pre className="bg-muted max-h-96 overflow-auto rounded-md p-3 text-xs">
								{run.data.data !== undefined && run.data.data !== null ? JSON.stringify(run.data.data, null, 2) : run.data.text}
							</pre>
						)}
					</CardContent>
				)}
			</Card>
		</div>
	);
}
