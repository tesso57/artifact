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
| `Mermaid chart label? className?` | **any diagram** (flowchart, sequence, state, ER, class, gantt, timeline, mindmap) — renders Mermaid as SVG, follows light/dark, shows syntax errors |
| `DiagramCard title description? chart` | a card holding one Mermaid diagram (title + caption) |
| `ChartCard title description? action? height?` | a card holding one recharts chart (wraps `ResponsiveContainer`) — numbers only |
| `axisProps`, `gridProps`, `tooltipProps`, `CHART_COLORS` | spread onto recharts parts for themed charts |
| `GanttChart tasks className? empty? aria-label?` | read-only timeline with inclusive dates and optional progress |
| `Markdown` | themed GitHub-flavored Markdown from a string (raw HTML ignored) |
| `MarkdownDocuments documents initialPath? className?` | navigate a supplied collection of Markdown snapshots, including relative `.md` links |
| `DataTable data columns loading? search? pageSize? initialSort? onRowClick? toolbar? empty?` | any list of records |
| `createColumns<Row>()`, `SortHeader` | columns for `DataTable` |
| `QueryState query loading? empty? isEmpty?` `{(data) => …}` | render any `useQuery` result with loading/error(retry)/empty |
| `McpQuery tool args? select? isEmpty? refetchInterval?` `{(data, text) => …}` | call an MCP tool and render its data with all states; `isEmpty` overrides the default empty check |
| `LoadingState`, `ErrorState`, `EmptyState`, `MutationError` | the same states on their own |

`QueryState` and `McpQuery` offer retry for failed queries. Errors thrown by local `select`
or `isEmpty` callbacks are displayed without retrying the underlying tool.
`DataTable` rows with `onRowClick` can also be activated with Enter or Space; interactive
controls inside a row keep their own actions without activating the row.

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

Project timelines and formatted text:

```tsx
import { GanttChart, Markdown } from "@/components/blocks";

<GanttChart tasks={[{ id: "design", label: "Design", start: "2026-11-01", end: "2026-11-07", progress: 60 }]} />
<Markdown>{"## Notes\n\n- [x] Scope agreed\n- [ ] Review"}</Markdown>
```

Gantt dates are inclusive `YYYY-MM-DD` calendar dates. `progress` is an optional percentage
from 0 to 100; invalid dates or progress are shown as errors. Markdown supports GitHub-flavored tables and task lists;
raw HTML is ignored and unsafe links are filtered.
Use `aria-label` to give each chart a distinct accessible name when a page has multiple timelines.

For related Markdown files, copy the files into the artifact directory while preserving their
relative paths, import them with `?raw`, and supply the same relative paths to `MarkdownDocuments`:

```tsx
import { MarkdownDocuments } from "@/components/blocks";
import overview from "./docs/index.md?raw";
import design from "./docs/design.md?raw";

<MarkdownDocuments documents={[
  { path: "docs/index.md", title: "Overview", content: overview },
  { path: "docs/design.md", title: "Design", content: design },
]} />
```

Each path must be unique. Relative links between included `.md` documents open in the viewer,
including GitHub-style heading fragments; missing targets are reported with their resolved relative path.
External links remain normal links.
The snapshots are bundled into an export; recopy files when the originals change.

Diagrams — Mermaid, always (structure and flow; never hand-built boxes or SVG):

```tsx
import { DiagramCard, Mermaid } from "@/components/blocks";

<DiagramCard
	title="Request flow"
	description="Payment is confirmed before the order is saved."
	chart={`sequenceDiagram
  actor C as Customer
  C->>API: POST /orders
  API->>Payments: charge
  Payments-->>API: approved
  API-->>C: 201 Created`}
/>

// Inline, without a card (e.g. inside a Section or a Tabs panel):
<Mermaid chart={`flowchart LR\n  A[Draft] --> B{Review} -->|ok| C[Published]\n  B -->|changes| A`} />
```

Build `chart` strings from data when the diagram depends on it (e.g. map MCP results to
`flowchart` nodes); keep node ids simple (`a1`, `svc_api`) and put text in labels:
`a1["Orders API"]`. Quote labels that contain punctuation.

Charts — recharts with theme tokens, always inside `ChartCard` (numbers only):

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
