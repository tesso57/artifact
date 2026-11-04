---
name: artifacts
description: Build live, interactive React artifacts (dashboards, tools, trackers, reports, prototypes) that open in the browser, styled with shadcn/ui and powered by TanStack Query/Table, with persistent memory and access to pi's MCP tools. Use when the user wants something visual or interactive to look at or use, or asks to change, export or share an existing artifact.
---

# Artifacts

An artifact is one TSX module with a default-exported React component. `artifact_write`
saves it to `~/.pi/artifacts/<id>/index.tsx` and serves it from a shared TanStack Start
dev server with hot reload. It runs client-side: React 19, Tailwind CSS v4, shadcn/ui.

## Workflow

1. **Understand the job.** What should the user see or do, with which data? If the data
   comes from an MCP server, find the exact tool and its arguments first (tool search /
   codemode). Ask at most one short question when something essential is unclear.
2. **Read the design system.** Read `references/design-system.md`, then the user's
   decisions in `~/.pi/artifacts/.design/DESIGN.md` if that file exists — they override
   the defaults.
3. **Start from a template.** `artifact_template` `list`, pick the closest by use case,
   `get` it, and adapt it. Write from scratch only when nothing fits.
4. **Build with blocks.** Prefer `@/components/blocks` (layout, data states, tables,
   charts, KPIs) over hand-rolled markup — see `references/components.md`.
5. **Write and verify.** `artifact_write` with a short title and one-sentence description.
   It returns the URL and any compile error; fix errors and write again. For small
   follow-up changes, edit the returned `index.tsx` path with the edit tool — the
   viewer hot-reloads.
6. **Hand over.** Give the URL and say in one or two sentences what it does and what is
   remembered. Offer `artifact_export` when they may want a single HTML file.

## Rules

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
  components below, one default export.

## References

- `references/components.md` — shadcn/ui components and blocks, with snippets
- `references/tanstack.md` — TanStack Query and Table v9 patterns
- `references/sdk.md` — `@pi/artifact`: memory, MCP, artifact info, export behaviour
- `references/design-system.md` — tokens, type scale, spacing, layout and chart rules
- `templates/<name>/template.tsx` — the bundled templates (also via `artifact_template`)

Related skills: `artifact-template-creator` (design a reusable template with the user),
`artifact-design-system` (change and maintain the look of all artifacts).
