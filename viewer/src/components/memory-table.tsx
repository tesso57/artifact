import { useQueryClient } from "@tanstack/react-query";
import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	sortFn_alphanumeric,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { ArrowUpDown, RefreshCw, Trash2 } from "lucide-react";
import { useMemo } from "react";
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
	const columns = useMemo(
		() =>
			helper.columns([
				helper.accessor("key", {
					header: ({ column }) => (
						<Button variant="ghost" size="sm" onClick={() => column.toggleSorting()}>
							Key <ArrowUpDown />
						</Button>
					),
					cell: ({ getValue }) => <code className="font-mono text-xs">{getValue()}</code>,
				}),
				helper.accessor("value", {
					header: "Value",
					enableSorting: false,
					cell: ({ getValue }) => (
						<pre className="max-w-xl overflow-hidden font-mono text-xs text-ellipsis">
							{JSON.stringify(getValue(), null, 0)}
						</pre>
					),
				}),
				helper.accessor("updatedAt", {
					header: ({ column }) => (
						<Button variant="ghost" size="sm" onClick={() => column.toggleSorting()}>
							Updated <ArrowUpDown />
						</Button>
					),
					cell: ({ getValue }) => <span className="text-muted-foreground text-xs">{timeAgo(getValue())}</span>,
				}),
				helper.display({
					id: "actions",
					cell: ({ row }) => (
						<Button
							variant="ghost"
							size="icon"
							aria-label={`Delete ${row.original.key}`}
							onClick={async () => {
								await memory.delete(scope, row.original.key);
								await qc.invalidateQueries({ queryKey: ["pi-memory"] });
								await qc.invalidateQueries({ queryKey: ["pi-memory-list"] });
							}}
						>
							<Trash2 />
						</Button>
					),
				}),
			]),
		[scope, qc],
	);

	const table = useTable({
		features,
		columns,
		data: (list.data as Row[] | undefined) ?? EMPTY,
		initialState: { sorting: [{ id: "updatedAt", desc: true }] },
	});

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<p className="text-muted-foreground text-sm">
					SQLite memory for scope <code className="font-mono">{scope}</code>
				</p>
				<Button variant="outline" size="sm" className="ml-auto" onClick={() => list.refetch()}>
					<RefreshCw className={list.isFetching ? "animate-spin" : ""} /> Refresh
				</Button>
			</div>
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((hg) => (
							<TableRow key={hg.id}>
								{hg.headers.map((h) => (
									<TableHead key={h.id}>{h.isPlaceholder ? null : <table.FlexRender header={h} />}</TableHead>
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
									{list.isPending ? "Loading…" : "Nothing stored yet."}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
