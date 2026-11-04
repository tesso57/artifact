import { useMutation } from "@tanstack/react-query";
import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportArtifactFn } from "@/server/fns";

function download(fileName: string, html: string) {
	const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
	const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Bundle the artifact into one self-contained HTML file and download it. */
export function ExportButton({ id }: { id: string }) {
	const exp = useMutation({
		mutationFn: () => exportArtifactFn({ data: id }),
		onSuccess: (r) => download(r.fileName, r.html),
	});
	return (
		<Button
			variant="outline"
			size="sm"
			disabled={exp.isPending}
			onClick={() => exp.mutate()}
			title={exp.error ? String(exp.error) : "Download as a single HTML file"}
			aria-label="Export as HTML"
		>
			{exp.isPending ? <LoaderCircle className="animate-spin" /> : <Download />}
			<span className="hidden md:inline">{exp.isError ? "Retry export" : "Export"}</span>
		</Button>
	);
}
