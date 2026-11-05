# TanStack Query and Table

A `QueryClientProvider` is already mounted. Retries are 1 and data refetches on window
focus.

## Query

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const q = useQuery({ queryKey: ["weather", city], queryFn: () => callMcp("weather.forecast", { city }) });
// Render with <QueryState query={q}>{(r) => …}</QueryState>
```

- Keys are arrays of everything the query depends on (`["issues", repo, state]`).
- `useMcp(name, args)` is `useQuery` keyed by tool and args — prefer it for MCP reads.
- After a mutation, invalidate the reads it affects:
  `onSuccess: () => qc.invalidateQueries({ queryKey: ["issues"] })`.
- Optimistic UI for small local changes: `qc.setQueryData(key, next)` then mutate.
- Polling: `refetchInterval: 30_000` (also on `<McpQuery>`).
- Derived data: compute with `useMemo` from `q.data`, or `select` in `useQuery`.

## Table (v9 — not v8)

Use `<DataTable>` from blocks for almost everything. Build columns with its helper so the
feature types line up:

```tsx
import { createColumns, DataTable, SortHeader } from "@/components/blocks";

type Row = { name: string; size: number; updated: string };
const col = createColumns<Row>();
const columns = col.columns([
	col.accessor("name", { header: ({ column }) => <SortHeader column={column}>Name</SortHeader> }),
	col.accessor("size", { header: "Size", cell: (c) => `${(c.getValue() / 1024).toFixed(1)} KB` }),
	col.display({ id: "actions", cell: ({ row }) => <Button size="sm" onClick={() => open(row.original)}>Open</Button> }),
]);

<DataTable data={rows} columns={columns} loading={q.isPending} initialSort={{ id: "size", desc: true }} />
```

Define `columns` at module scope (or `useMemo`); never create them inline in render.

When you need a custom table (selection, grouping, pinning), use v9 directly:

```tsx
import {
	createColumnHelper, createSortedRowModel, rowSelectionFeature, rowSortingFeature,
	sortFn_alphanumeric, tableFeatures, useTable,
} from "@tanstack/react-table";

const features = tableFeatures({
	rowSortingFeature, rowSelectionFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: { alphanumeric: sortFn_alphanumeric },
});
const helper = createColumnHelper<typeof features, Row>();
const columns = helper.columns([/* … */]);

const table = useTable({ features, columns, data: rows, initialState: { sorting: [{ id: "name", desc: false }] } });
// header: <table.FlexRender header={h} />  cell: <table.FlexRender cell={c} />  rows: row.getAllCells()
```

v9 names: `useTable` (not `useReactTable`), `tableFeatures({...})` registers features and
row models (`createFilteredRowModel`, `createSortedRowModel`, `createPaginatedRowModel`),
`filterFn_includesString` / `sortFn_alphanumeric` are imported individually,
`table.FlexRender` replaces `flexRender`, `row.getAllCells()` unless
`columnVisibilityFeature` is registered. Global filter needs `columnFilteringFeature` +
`globalFilteringFeature` + `filteredRowModel`. Keep `data` referentially stable
(`useMemo`, module constants) — a new `[]` each render resets the table.
