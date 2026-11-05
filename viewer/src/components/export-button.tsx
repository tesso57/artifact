import { useMutation } from "@tanstack/react-query";
import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { exportArtifactFn } from "@/server/fns";

function download(fileName: string, html: string) {
	const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
	const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function List({ label, items }: { label: string; items: string[] }) {
	return (
		<div className="space-y-1">
			<p className="text-sm font-medium">
				{label} <span className="text-muted-foreground">({items.length})</span>
			</p>
			{items.length > 0 && (
				<ul className="bg-muted max-h-32 overflow-auto rounded-md p-2 font-mono text-xs">
					{items.map((i) => (
						<li key={i} className="truncate">{i}</li>
					))}
				</ul>
			)}
		</div>
	);
}

/** Bundle the artifact into one self-contained HTML file; show what it embeds before saving. */
export function ExportButton({ id }: { id: string }) {
	const exp = useMutation({ mutationFn: () => exportArtifactFn({ data: id }) });
	const r = exp.data;
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				disabled={exp.isPending}
				onClick={() => exp.mutate()}
				title={exp.error ? String(exp.error) : "Export as a single HTML file"}
				aria-label="Export as HTML"
			>
				{exp.isPending ? <LoaderCircle className="animate-spin" /> : <Download />}
				<span className="hidden md:inline">{exp.isError ? "Retry export" : "Export"}</span>
			</Button>
			<Dialog open={!!r} onOpenChange={(open) => !open && exp.reset()}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Export {r?.fileName}</DialogTitle>
						<DialogDescription>
							One self-contained file ({r ? Math.round(r.bytes / 1024) : 0} KB) that works offline. Besides the code it
							contains this data — check it before you share the file.
						</DialogDescription>
					</DialogHeader>
					{r && (
						<div className="grid gap-3">
							<List label="Memory keys" items={r.embedded.memoryKeys} />
							<List label="Shared memory keys" items={r.embedded.sharedKeys} />
							<List label="MCP results" items={r.embedded.mcpCalls} />
						</div>
					)}
					<DialogFooter>
						<Button variant="outline" onClick={() => exp.reset()}>
							Cancel
						</Button>
						<Button
							onClick={() => {
								if (r) download(r.fileName, r.html);
								exp.reset();
							}}
						>
							<Download /> Download
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
