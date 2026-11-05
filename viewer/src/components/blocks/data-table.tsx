import {
	columnFilteringFeature,
	createColumnHelper,
	createFilteredRowModel,
	createPaginatedRowModel,
	createSortedRowModel,
	filterFn_includesString,
	globalFilteringFeature,
	rowPaginationFeature,
	type RowData,
	rowSortingFeature,
	sortFn_alphanumeric,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Features of <DataTable>; build columns with `createColumns<Row>()` so their types match. */
export const dataTableFeatures = tableFeatures({
	columnFilteringFeature,
	globalFilteringFeature,
	rowSortingFeature,
	rowPaginationFeature,
	filteredRowModel: createFilteredRowModel(),
	sortedRowModel: createSortedRowModel(),
	paginatedRowModel: createPaginatedRowModel(),
	filterFns: { includesString: filterFn_includesString },
	sortFns: { alphanumeric: sortFn_alphanumeric },
});

/** Column helper for <DataTable>: `const col = createColumns<Row>(); const columns = col.columns([...])`. */
export function createColumns<TRow extends RowData>() {
	return createColumnHelper<typeof dataTableFeatures, TRow>();
}

type ColumnsOf<TRow extends RowData> = ReturnType<ReturnType<typeof createColumns<TRow>>["columns"]>;

const EMPTY: never[] = [];

/** Clickable sortable header: `header: ({ column }) => <SortHeader column={column}>Name</SortHeader>`. */
export function SortHeader({
	column,
	children,
}: {
	column: { toggleSorting: () => void; getIsSorted: () => false | "asc" | "desc" };
	children: ReactNode;
}) {
	const dir = column.getIsSorted();
	const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
	return (
		<Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => column.toggleSorting()}>
			{children} <Icon className={cn(!dir && "opacity-40")} />
		</Button>
	);
}

/**
 * shadcn table driven by TanStack Table v9: search, sorting, pagination, loading
 * skeleton and empty row. Columns come from `createColumns<Row>()`.
 */
export function DataTable<TRow extends RowData>({
	data,
	columns,
	loading,
	search = true,
	searchPlaceholder = "Search…",
	pageSize = 10,
	empty = "No results.",
	initialSort,
	getRowId,
	onRowClick,
	toolbar,
	className,
}: {
	data: TRow[] | undefined;
	columns: ColumnsOf<TRow>;
	/** Show skeleton rows (e.g. `query.isPending`). */
	loading?: boolean;
	search?: boolean;
	searchPlaceholder?: string;
	/** Rows per page; 0 disables pagination. */
	pageSize?: number;
	empty?: ReactNode;
	initialSort?: { id: string; desc?: boolean };
	getRowId?: (row: TRow) => string;
	onRowClick?: (row: TRow) => void;
	/** Extra controls next to the search box (filters, buttons). */
	toolbar?: ReactNode;
	className?: string;
}) {
	const [query, setQuery] = useState("");
	const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: pageSize || Number.MAX_SAFE_INTEGER });
	const table = useTable({
		features: dataTableFeatures,
		columns,
		// v9 needs a stable array: a fresh `[]` each render would reset the row models.
		data: data ?? (EMPTY as TRow[]),
		getRowId,
		globalFilterFn: "includesString",
		state: { globalFilter: query, pagination },
		onPaginationChange: setPagination,
		initialState: initialSort ? { sorting: [{ id: initialSort.id, desc: !!initialSort.desc }] } : undefined,
	});
	const colCount = table.getAllLeafColumns().length;
	const pageCount = table.getPageCount();

	return (
		<div className={cn("space-y-3", className)}>
			{(search || toolbar) && (
				<div className="flex flex-wrap items-center gap-2">
					{search && (
						<div className="relative w-full max-w-xs">
							<Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
							<Input
								value={query}
								onChange={(e) => {
									setQuery(e.target.value);
									setPagination((p) => ({ ...p, pageIndex: 0 }));
								}}
								placeholder={searchPlaceholder}
								className="pl-9"
								aria-label="Search"
							/>
						</div>
					)}
					{toolbar}
				</div>
			)}
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((g) => (
							<TableRow key={g.id}>
								{g.headers.map((h) => (
									<TableHead key={h.id}>{h.isPlaceholder ? null : <table.FlexRender header={h} />}</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{loading ? (
							Array.from({ length: Math.min(pageSize || 5, 5) }, (_, i) => (
								<TableRow key={i}>
									{Array.from({ length: colCount }, (_, j) => (
										<TableCell key={j}>
											<Skeleton className="h-5 w-full max-w-40" />
										</TableCell>
									))}
								</TableRow>
							))
						) : table.getRowModel().rows.length ? (
							table.getRowModel().rows.map((r) => (
								<TableRow
									key={r.id}
									className={cn(onRowClick && "cursor-pointer")}
									onClick={onRowClick ? () => onRowClick(r.original) : undefined}
								>
									{r.getAllCells().map((c) => (
										<TableCell key={c.id}>
											<table.FlexRender cell={c} />
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell colSpan={colCount} className="text-muted-foreground h-24 text-center">
									{empty}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			{pageSize > 0 && pageCount > 1 && (
				<div className="flex items-center justify-end gap-2 text-sm">
					<span className="text-muted-foreground mr-auto">
						{table.getFilteredRowModel().rows.length} rows · page {pagination.pageIndex + 1} of {pageCount}
					</span>
					<Button variant="outline" size="icon" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
						<ChevronLeft />
					</Button>
					<Button variant="outline" size="icon" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
						<ChevronRight />
					</Button>
				</div>
			)}
		</div>
	);
}
