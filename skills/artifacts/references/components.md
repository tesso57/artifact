# Components

Import from `@/components/ui/<name>` (shadcn/ui, new-york style) and `@/components/blocks`
(shadcn + TanStack compositions). Icons: `lucide-react`. Class merging: `cn` from
`@/lib/utils`.

## Blocks (`@/components/blocks`)

| Block | Use it for |
|---|---|
| `Page width?="sm\|md\|lg\|xl\|full"` | outer wrapper of every artifact (default `xl`) |
| `PageHeader title description? actions? eyebrow?` | the page title row; put Tabs/Buttons in `actions` |
| `Section title? description? actions?` | a titled group of content |
| `Grid cols?={1\|2\|3\|4}` | responsive card grids (1 column on phones) |
| `StatCard title value delta? hint? icon? loading? invert?` | KPI numbers; `delta` is a % change, `invert` when down is good |
| `ChartCard title description? action? height?` | a card holding one recharts chart (wraps `ResponsiveContainer`) |
| `axisProps`, `gridProps`, `tooltipProps`, `CHART_COLORS` | spread onto recharts parts for themed charts |
| `DataTable data columns loading? search? pageSize? initialSort? onRowClick? toolbar? empty?` | any list of records |
| `createColumns<Row>()`, `SortHeader` | columns for `DataTable` |
| `QueryState query loading? empty? isEmpty?` `{(data) => …}` | render any `useQuery` result with loading/error(retry)/empty |
| `McpQuery tool args? select? refetchInterval?` `{(data, text) => …}` | call an MCP tool and render its data with all states |
| `LoadingState`, `ErrorState`, `EmptyState`, `MutationError` | the same states on their own |

```tsx
import { McpQuery, Page, PageHeader, Section, Grid, StatCard, DataTable, createColumns, SortHeader } from "@/components/blocks";

type Issue = { number: number; title: string; state: string; comments: number };
const col = createColumns<Issue>();
const columns = col.columns([
	col.accessor("number", { header: "#" }),
	col.accessor("title", { header: ({ column }) => <SortHeader column={column}>Title</SortHeader> }),
	col.accessor("comments", { header: ({ column }) => <SortHeader column={column}>Comments</SortHeader> }),
]);

// artifact_write(..., mcp: ["github.list_issues"]) — the allowlist this code needs.
export default function Issues() {
	return (
		<Page>
			<PageHeader title="Open issues" description="From the GitHub MCP server" />
			<McpQuery<Issue[]> tool="github.list_issues" args={{ state: "open" }}>
				{(issues) => (
					<>
						<Grid cols={3}>
							<StatCard title="Open" value={issues.length} />
							<StatCard title="Comments" value={issues.reduce((s, i) => s + i.comments, 0)} />
						</Grid>
						<Section title="All issues">
							<DataTable data={issues} columns={columns} initialSort={{ id: "comments", desc: true }} />
						</Section>
					</>
				)}
			</McpQuery>
		</Page>
	);
}
```

Charts — recharts with theme tokens, always inside `ChartCard`:

```tsx
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, ChartCard, gridProps, tooltipProps } from "@/components/blocks";

<ChartCard title="Signups" description="Per week">
	<BarChart data={rows}>
		<CartesianGrid {...gridProps} />
		<XAxis dataKey="week" {...axisProps} />
		<YAxis width={32} {...axisProps} />
		<Tooltip {...tooltipProps} />
		<Bar dataKey="count" fill="var(--chart-1)" radius={4} />
	</BarChart>
</ChartCard>
```

## shadcn/ui (`@/components/ui/*`)

| Module | Exports |
|---|---|
| `button` | `Button` (variant: default, secondary, outline, ghost, destructive, link; size: default, sm, lg, icon; `asChild`) |
| `card` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter` |
| `badge` | `Badge` (variant: default, secondary, outline, destructive) |
| `input`, `textarea`, `label` | `Input`, `Textarea`, `Label` |
| `checkbox`, `switch` | `Checkbox`, `Switch` (`checked`, `onCheckedChange`) |
| `select` | `Select`, `SelectTrigger` (size sm), `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup` |
| `tabs` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |
| `dialog` | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose` |
| `table` | `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption` |
| `alert` | `Alert` (variant default, destructive), `AlertTitle`, `AlertDescription` |
| `progress`, `skeleton`, `separator` | `Progress` (`value` 0–100), `Skeleton`, `Separator` |

Patterns:

- Forms: `<Label htmlFor>` + control in a `grid gap-2`; submit with a `<form onSubmit>` so
  Enter works; disable the submit button while invalid or pending.
- Selects: `<Select value onValueChange><SelectTrigger aria-label><SelectValue /></SelectTrigger><SelectContent><SelectItem value>…`.
- Icon-only buttons need `aria-label`.
- Prefer `Tabs` in `PageHeader actions` for switching views or ranges.
