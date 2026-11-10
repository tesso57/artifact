import { useEffect, useId, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ErrorState } from "./query-state";

type MermaidApi = typeof import("mermaid").default;
let mermaidPromise: Promise<MermaidApi> | undefined;
// Loaded on first use: Mermaid is large, and most artifacts have no diagram.
const loadMermaid = () => (mermaidPromise ??= import("mermaid").then((m) => m.default));

/** Whether the page is in dark mode (the `dark` class on <html>), kept up to date. */
function useDarkMode(): boolean {
	const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
	useEffect(() => {
		const root = document.documentElement;
		const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);
	return dark;
}

/**
 * Render a Mermaid diagram (flowchart, sequence, class, state, ER, gantt, timeline, mindmap,
 * …) as SVG. Follows the light/dark theme; a syntax error shows an error panel with the
 * message instead of breaking the artifact.
 *
 *   <Mermaid chart={`flowchart LR\n  A[Client] --> B[API] --> C[(DB)]`} />
 */
export function Mermaid({ chart, className, label }: { chart: string; className?: string; label?: string }) {
	const dark = useDarkMode();
	const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const [state, setState] = useState<{ svg?: string; error?: unknown }>({});

	useEffect(() => {
		let cancelled = false;
		loadMermaid()
			.then(async (mermaid) => {
				mermaid.initialize({
					startOnLoad: false,
					theme: dark ? "dark" : "neutral",
					// "strict": no click handlers or HTML labels from the diagram text.
					securityLevel: "strict",
					fontFamily: "inherit",
				});
				const { svg } = await mermaid.render(`${id}-${dark ? "d" : "l"}`, chart.trim());
				if (!cancelled) setState({ svg });
			})
			.catch((error) => !cancelled && setState({ error }));
		return () => {
			cancelled = true;
		};
	}, [chart, dark, id]);

	if (state.error) return <ErrorState title="Invalid Mermaid diagram" error={state.error} className={className} />;
	if (!state.svg) return <Skeleton className={cn("h-48 w-full", className)} />;
	return (
		<div
			data-mermaid
			role="img"
			aria-label={label ?? "Diagram"}
			className={cn("flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full", className)}
			// Mermaid's own SVG output, rendered with securityLevel "strict" (sanitized).
			// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized Mermaid SVG
			dangerouslySetInnerHTML={{ __html: state.svg }}
		/>
	);
}

/** A card holding one Mermaid diagram, like ChartCard for charts. */
export function DiagramCard({
	title,
	description,
	chart,
	className,
}: {
	title: string;
	description?: string;
	chart: string;
	className?: string;
}) {
	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{description && <CardDescription>{description}</CardDescription>}
			</CardHeader>
			<CardContent>
				<Mermaid chart={chart} label={title} />
			</CardContent>
		</Card>
	);
}
