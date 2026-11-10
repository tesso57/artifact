import type { ReactNode } from "react";
import { useMcp } from "@pi/artifact";
import { ErrorState, QueryState } from "./query-state";

/**
 * Call an MCP tool through pi and render its data with shadcn loading / error / empty states.
 *
 *   <McpQuery<Issue[]> tool="github.list_issues" args={{ state: "open" }}>
 *     {(issues) => <DataTable data={issues} columns={columns} />}
 *   </McpQuery>
 *
 * `children` receives `data` (structuredContent or parsed JSON) and the raw text.
 */
export function McpQuery<T = unknown>({
	tool,
	args = {},
	children,
	select,
	loading,
	empty,
	isEmpty,
	refetchInterval,
}: {
	tool: string;
	args?: Record<string, unknown>;
	children: (data: T, text: string) => ReactNode;
	/** Pick or reshape the part you need, e.g. `(d) => d.items`. */
	select?: (data: unknown) => T;
	loading?: ReactNode;
	empty?: ReactNode;
	isEmpty?: (data: T) => boolean;
	refetchInterval?: number;
}) {
	const query = useMcp<unknown>(tool, args, { refetchInterval });
	let selected: { value: T; text: string } | undefined;
	let selectionError: Error | undefined;
	if (query.data) {
		try { selected = { value: (select ? select(query.data.data) : query.data.data) as T, text: query.data.text }; }
		catch (error) { selectionError = error instanceof Error ? error : new Error(String(error)); }
	}
	if (selectionError && !query.error) return <ErrorState error={selectionError} title={`${tool} failed`} />;
	const shaped = {
		...query,
		data: selected,
		error: query.error ?? selectionError,
	};
	return (
		<QueryState
			query={shaped}
			loading={loading}
			empty={empty}
			errorTitle={`${tool} failed`}
			isEmpty={(d) => isEmpty ? isEmpty(d.value) : (d.value == null && !d.text) || (Array.isArray(d.value) && d.value.length === 0)}
		>
			{(d) => children(d.value, d.text)}
		</QueryState>
	);
}
