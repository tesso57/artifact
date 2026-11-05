# Design system (defaults)

The defaults below apply unless `~/.pi/artifacts/.design/DESIGN.md` says otherwise.
Tokens are CSS variables (shadcn naming) defined in the viewer's `styles.css` and may be
overridden in `~/.pi/artifacts/.design/theme.css`; use them through Tailwind classes.

## Principles

1. **Quiet by default.** Neutral surfaces, one accent (`primary`), color only where it
   carries meaning (status, deltas, chart series).
2. **Content first.** The data or the task is the hero; chrome stays minimal. No
   decorative gradients, emoji headers or marketing copy.
3. **Consistent skeleton.** Every artifact is `Page` → `PageHeader` → `Section`s.
4. **Every state designed.** Loading (skeletons), empty (a sentence and maybe an action),
   error (what failed + retry).

## Tokens

| Role | Classes |
|---|---|
| Page / surfaces | `bg-background`, `bg-card` (+ `border`), `bg-muted` for wells and code |
| Text | `text-foreground`, `text-muted-foreground` for secondary text |
| Accent | `bg-primary text-primary-foreground`, `text-primary` |
| Danger | `text-destructive`, `variant="destructive"` |
| Positive | `text-emerald-600 dark:text-emerald-400` (the only non-token color allowed) |
| Lines | `border`, `divide-y`, `Separator` |
| Focus | provided by components (`ring`) — don't remove outlines |
| Charts | `var(--chart-1)` … `var(--chart-5)`, in that order; `CHART_COLORS` |
| Radius | `rounded-md` controls, `rounded-lg` panels, `rounded-xl` cards (from `--radius`) |

## Type scale

| Use | Classes |
|---|---|
| Page title | `text-2xl font-semibold tracking-tight` (PageHeader) |
| Section title | `text-lg font-semibold tracking-tight` (Section) |
| Card title | `CardTitle` (`font-semibold`) |
| Body | `text-sm` |
| Secondary / captions | `text-sm text-muted-foreground`, `text-xs` for meta |
| Numbers | `tabular-nums`; big KPIs `text-2xl` (StatCard) |
| Code / ids | `font-mono text-xs` |

## Spacing and layout

- Page sections: `gap-8` (Page). Inside sections and between cards: `gap-4`. Inside
  cards: `gap-6` (Card default) / `space-y-3` for dense lists.
- Widths: `Page width` `xl` for dashboards, `lg` for tables, `md` for documents/forms,
  `sm` for single small tools.
- Grids: `Grid cols={2|3|4}`; never more than 4 KPI cards in a row.
- Mobile: no horizontal page scroll at 375px; tables scroll inside their container.

## Components

- Buttons: one `default` (primary) action per view; others `outline` or `ghost`.
  Destructive actions use `variant="destructive"` and confirm in a `Dialog`.
- Status: `Badge` — `default` active/success, `secondary` pending, `outline` inactive,
  `destructive` failed.
- Lists of records: `DataTable`. Small fixed lists: a `Card` with `divide-y` rows.
- Forms: `Label` above control, helper text `text-xs text-muted-foreground`, inline
  errors `text-destructive text-xs`.

## Charts

- Always in `ChartCard`, with `gridProps`, `axisProps`, `tooltipProps`.
- Line/area for trends over time, bar for comparisons between categories, no pie charts
  with more than 4 slices (use a bar chart).
- Label units in the description ("Daily, in USD"); format ticks (`12k`, `3.4%`).

## Writing

- Sentence case for titles and buttons ("Add habit", not "Add Habit").
- Say what something is, not that it is "powerful" or "beautiful".
- Numbers with `Intl.NumberFormat`; dates with `toLocaleDateString`.
