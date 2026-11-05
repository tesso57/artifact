# Tokens

All tokens are CSS variables on `:root` (light) and `.dark`, mapped to Tailwind colors by
`@theme inline` in the viewer's `styles.css`.

| Variable | Tailwind | Used for |
|---|---|---|
| `--background` / `--foreground` | `bg-background` / `text-foreground` | page |
| `--card` / `--card-foreground` | `bg-card` | cards |
| `--popover` / `--popover-foreground` | `bg-popover` | menus, select, tooltips |
| `--primary` / `--primary-foreground` | `bg-primary`, `text-primary` | main action, active states |
| `--secondary` / `--secondary-foreground` | `bg-secondary` | secondary buttons, badges |
| `--muted` / `--muted-foreground` | `bg-muted`, `text-muted-foreground` | wells, secondary text |
| `--accent` / `--accent-foreground` | `bg-accent` | hover backgrounds |
| `--destructive` | `bg-destructive`, `text-destructive` | errors, delete |
| `--border`, `--input`, `--ring` | `border`, `ring` | lines, inputs, focus |
| `--chart-1` … `--chart-5` | `var(--chart-n)` | chart series |
| `--radius` | `rounded-sm/md/lg/xl` | corner radius (derived sizes) |

Default values: neutral grays (`oklch(… 0 0)`), radius `0.625rem`. Fonts follow the
system UI stack unless `body { font-family }` is overridden.
