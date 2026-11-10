# Authoring a template

A template is a complete, working artifact that someone else can adapt in minutes.

```tsx
/**
 * Template: <title> — one sentence on what it shows and for whom.
 * Adapt: what to change (CONFIG, data source, columns).
 */
import …

// ---- CONFIG: what varies between uses ----------------------------------------
const CONFIG = {
	title: "Weekly stand-up",
	repo: "acme/web",          // passed to MCP calls
	staleAfterDays: 7,         // thresholds, labels, ranges…
} as const;

// ---- Types and sample data -----------------------------------------------------
type Item = { … };
const SAMPLE: Item[] = [ … ];  // realistic, used when no live data is wired up

// ---- Columns, helpers ----------------------------------------------------------

export default function StandUp() {
	// live data: useMcp / <McpQuery>; remembered settings: useMemory
	return <Page>…</Page>;
}
```

Rules:

- Everything that changes between uses is in `CONFIG` at the top — no magic strings in
  JSX.
- Render something meaningful with no live data: realistic `SAMPLE` data, or a clear
  `EmptyState` explaining what to connect.
- Use the design system and blocks (`Page`, `PageHeader`, `Section`, `Grid`, `StatCard`,
  `ChartCard`, `DataTable`, `QueryState`/`McpQuery`); no custom colors.
- Diagrams are Mermaid (`Mermaid` / `DiagramCard`), with the chart source in `CONFIG` or a
  constant so users can adapt it.
- Handle loading, error and empty states for every async source.
- Remember user choices (filters, ranges, toggles) with `useMemory`.
- Keep it under ~250 lines; split repeated markup into small components in the file.
- `name`: short slug (`standup-board`). `title`: 2–4 words. `description`: one sentence of
  what it shows. `useCases`: 2–4 phrasings of requests it should be chosen for. `tags`:
  a few nouns (`table`, `chart`, `github`, `tracker`).
