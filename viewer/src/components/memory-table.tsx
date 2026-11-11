import { useQueryClient } from "@tanstack/react-query";
import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	sortFn_alphanumeric,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { SortHeader } from "@/components/blocks/data-table";
import { ErrorState } from "@/components/blocks/query-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { timeAgo } from "@/lib/format";
import { memory, useMemoryList } from "@pi/artifact";

type Row = { key: string; value: unknown; updatedAt: number };

// TanStack Table v9: features and the column helper live at module scope.
const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: { alphanumeric: sortFn_alphanumeric },
});
const helper = createColumnHelper<typeof features, Row>();
const EMPTY: Row[] = [];

export function MemoryTable({ scope }: { scope: string }) {
	const list = useMemoryList({ scope });
	const qc = useQueryClient();
	const [deleteError, setDeleteError] = useState<Error | undefined>();
	const pendingDeletes = useRef(new Set<string>());
	const [deleting, setDeleting] = useState<Set<string>>(() => new Set());
	const columns = useMemo(
		() =>
			helper.columns([
				helper.accessor("key", {
					header: ({ column }) => <SortHeader column={column}>Key</SortHeader>,
					cell: ({ getValue }) => <code className="block max-w-48 break-all whitespace-normal font-mono text-xs">{getValue()}</code>,
				}),
				helper.accessor("value", {
					header: "Value",
					enableSorting: false,
					cell: ({ getValue }) => (
						<pre className="max-w-xl break-all whitespace-pre-wrap font-mono text-xs">
							{JSON.stringify(getValue(), null, 0)}
						</pre>
					),
				}),
				helper.accessor("updatedAt", {
					header: ({ column }) => <SortHeader column={column}>Updated</SortHeader>,
					cell: ({ getValue }) => <span className="text-muted-foreground text-xs">{timeAgo(getValue())}</span>,
				}),
				helper.display({
					id: "actions",
					cell: ({ row }) => (
						<Button
							variant="ghost"
							size="icon"
							aria-label={`${deleting.has(row.original.key) ? "Deleting" : "Delete"} ${row.original.key}`}
							disabled={deleting.has(row.original.key)}
							onClick={async () => {
								const key = row.original.key;
								if (pendingDeletes.current.has(key)) return;
								pendingDeletes.current.add(key);
								setDeleting(new Set(pendingDeletes.current));
								setDeleteError(undefined);
								try {
									await memory.delete(scope, key);
									await qc.invalidateQueries({ queryKey: ["pi-memory"] });
									await qc.invalidateQueries({ queryKey: ["pi-memory-list"] });
								} catch (error) {
									setDeleteError(error instanceof Error ? error : new Error(String(error)));
								} finally {
									pendingDeletes.current.delete(key);
									setDeleting(new Set(pendingDeletes.current));
								}
							}}
						>
							{deleting.has(row.original.key) ? <LoaderCircle className="motion-safe:animate-spin" /> : <Trash2 />}
						</Button>
					),
				}),
			]),
		[scope, qc, deleting],
	);

	const table = useTable({
		features,
		columns,
		data: (list.data as Row[] | undefined) ?? EMPTY,
		initialState: { sorting: [{ id: "updatedAt", desc: true }] },
	});

	return (
		<div className="space-y-3">
			{list.error && <ErrorState title="Could not load memory" error={list.error} onRetry={() => list.refetch()} />}
			{deleteError && <ErrorState title="Could not delete memory" error={deleteError} />}
			<div className="flex items-center gap-2">
				<p className="text-muted-foreground text-sm">
					SQLite memory for scope <code className="font-mono">{scope}</code>
				</p>
				<Button variant="outline" size="sm" className="ml-auto" onClick={() => list.refetch()}>
					<RefreshCw className={list.isFetching ? "animate-spin" : ""} /> Refresh
				</Button>
			</div>
			<div className="rounded-md border">
				<Table containerProps={{ role: "region", "aria-label": "Memory entries", tabIndex: 0, className: "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none" }}>
					<TableHeader>
						{table.getHeaderGroups().map((hg) => (
							<TableRow key={hg.id}>
								{hg.headers.map((h) => (
									<TableHead key={h.id} aria-sort={h.column.getIsSorted() === "asc" ? "ascending" : h.column.getIsSorted() === "desc" ? "descending" : undefined}>{h.isPlaceholder ? null : <table.FlexRender header={h} />}</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow key={row.id}>
									{row.getAllCells().map((cell) => (
										<TableCell key={cell.id}>
											<table.FlexRender cell={cell} />
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell colSpan={columns.length} className="text-muted-foreground h-20 text-center">
									{list.isPending ? "Loading…" : list.error ? "Memory could not be loaded." : "Nothing stored yet."}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
