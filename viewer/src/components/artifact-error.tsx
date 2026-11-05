import { TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ErrorPanel({ title, error }: { title: string; error: unknown }) {
	const message = error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack : undefined;
	return (
		<Alert variant="destructive" className="mx-auto max-w-3xl">
			<TriangleAlert />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>
				<pre className="w-full overflow-x-auto font-mono text-xs whitespace-pre-wrap">{message}</pre>
				{stack && (
					<details className="w-full">
						<summary className="cursor-pointer text-xs">Stack</summary>
						<pre className="overflow-x-auto font-mono text-[11px] whitespace-pre">{stack}</pre>
					</details>
				)}
			</AlertDescription>
		</Alert>
	);
}

interface Props {
	children: ReactNode;
	resetKey: unknown;
	onError?: (error: Error) => void;
}

/** Catches render errors of an artifact; resets when `resetKey` changes (new version). */
export class ArtifactErrorBoundary extends Component<Props, { error: Error | null; key: unknown }> {
	state = { error: null as Error | null, key: this.props.resetKey };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	static getDerivedStateFromProps(props: Props, state: { error: Error | null; key: unknown }) {
		return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
	}

	componentDidCatch(error: Error, _info: ErrorInfo) {
		this.props.onError?.(error);
	}

	render() {
		if (this.state.error) return <ErrorPanel title="The artifact crashed while rendering" error={this.state.error} />;
		return this.props.children;
	}
}
