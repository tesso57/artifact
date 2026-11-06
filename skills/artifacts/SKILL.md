---
name: artifacts
description: Build live, interactive React artifacts (dashboards, tools, trackers, reports, prototypes) that open in the browser, styled with shadcn/ui and powered by TanStack Query/Table, with persistent memory and access to pi's MCP tools. Use when the user wants something visual or interactive to look at or use, or asks to change, export or share an existing artifact.
---

# Artifacts

An artifact is one TSX module with a default-exported React component. `artifact_write`
saves it (the result gives the file path) and serves it from the user's viewer — one
TanStack Start dev server for all artifacts, with hot reload. It runs client-side:
React 19, Tailwind CSS v4, shadcn/ui.

## Workflow

1. **Understand the job.** What should the user see or do, with which data? If the data
   comes from an MCP server, find the exact tool and its arguments first (tool search /
   codemode). Ask at most one short question when something essential is unclear.
2. **Start from a template.** `artifact_template` `list` returns the templates (pick the
   closest by `useCases`, then `get` it and adapt it) and the `designDir`.
3. **Read the design system.** Read `references/design-system.md`, then `DESIGN.md` in
   that `designDir` if it exists — the user's decisions override the defaults.
4. **Build with blocks.** Prefer `@/components/blocks` (layout, data states, tables,
   charts, KPIs) over hand-rolled markup — see `references/components.md`.
5. **Write and verify.** `artifact_write` with a short title, a one-sentence description,
   and `mcp`: every MCP tool the code calls (`"server.tool"`, or `"server.*"`). Calls
   outside that list fail. It returns an **Open** link and compile errors — and, when the
   user has the artifact open, runtime errors from the browser. Fix them by writing again
   with the same `id` (omitting `id` always creates a new artifact).
6. **Hand over.** Give the Open link (it logs the browser in and expires after 30 minutes;
   `/artifacts` opens it again later) and say in one or two sentences what it does and
   what it remembers. Offer `artifact_export` when they may want a single HTML file.

## Rules

- **Diagrams are Mermaid, first.** Anything that shows structure or flow — architecture,
  request/sequence flows, state machines, ER/data models, class diagrams, processes,
  gantt/timelines, mindmaps — is drawn with `<Mermaid chart={...} />` or `<DiagramCard>`
  from `@/components/blocks`. Never build diagrams from divs, absolutely positioned boxes,
  hand-written SVG or chart libraries. When the user asks to "explain", "show how … works"
  or "visualize the design", start from the `diagram` template. Charts (recharts in
  `ChartCard`) are only for numbers.

- Layout: `<Page>` → `<PageHeader>` → `<Section>`s; grids with `<Grid cols>`. Mobile first:
  everything must work at 375px wide.
- Style only with Tailwind classes and theme tokens (`bg-card`, `text-muted-foreground`,
  `border`, `text-primary`, `var(--chart-1..5)`). No hex colors, no inline font sizes.
  Both light and dark themes are used — never hard-code white or black.
- Every async view handles loading, error and empty states: wrap queries in
  `<QueryState>` / `<McpQuery>`, pass `loading` to `<DataTable>` and `<StatCard>`.
- Data from MCP: `useMcp` / `<McpQuery>` (cached, refetchable) for reads,
  `useMcpMutation` for actions. Never invent tool names or result shapes — call the tool
  once yourself to see what it returns, then type it.
- State that should survive a reload (settings, entries, filters) goes in
  `useMemory(key, initial)`; transient UI state stays in `useState`.
- TanStack Table is **v9**: `useTable`, `tableFeatures`, `createColumnHelper`,
  `table.FlexRender`. `useReactTable`, `getCoreRowModel` and `flexRender` do not exist.
  Usually `<DataTable>` + `createColumns<Row>()` is all you need — `references/tanstack.md`.
- Only these packages exist: react, the `@/components/*` and `@/lib/utils` modules,
  `@pi/artifact`, lucide-react, recharts, @tanstack/react-query, @tanstack/react-table,
  radix-ui, class-variance-authority, clsx, tailwind-merge. No network fetches to
  arbitrary URLs: use MCP tools.
- Keep the module self-contained and readable: types and constants at the top,
  components below, one **named** default export (`export default function SalesBoard()`),
  so hot reload keeps state.
- Render data from MCP or memory as text; never with `dangerouslySetInnerHTML`.

## References

- `references/components.md` — shadcn/ui components and blocks, with snippets
- `references/tanstack.md` — TanStack Query and Table v9 patterns
- `references/sdk.md` — `@pi/artifact`: memory, MCP, artifact info, export behaviour
- `references/design-system.md` — tokens, type scale, spacing, layout and chart rules
- `templates/<name>/template.tsx` — the bundled templates (also via `artifact_template`)

Related skills: `artifact-template-creator` (design a reusable template with the user),
`artifact-design-system` (change and maintain the look of all artifacts).
