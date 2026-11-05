---
name: artifact-design-system
description: Change and maintain the design system all artifacts share — brand colors, radius, fonts, density, chart palette and usage rules — via theme.css token overrides and a living DESIGN.md, verified on the style-guide template. Use when the user wants artifacts to look different or on-brand, complains about the look, or wants to record or review design decisions.
---

# Artifact design system

Two files in the design folder customise every artifact, the viewer and HTML exports.
`artifact_template` `list` returns its path as `designDir` (usually
`~/.pi/artifacts/.design/`; create it if missing):

- `theme.css` — CSS overrides of the shadcn tokens, loaded after the defaults, so
  redefining a variable wins. The viewer reloads when it changes. Plain CSS only (no
  Tailwind directives); fonts must be installed locally or embedded as `data:` URLs —
  artifacts may not load anything from the network.
- `DESIGN.md` — the decisions: brand, tone, do/don't, chosen palette, component rules.
  The `artifacts` skill reads it before building anything, so keep it short and
  imperative.

Defaults live in the `artifacts` skill's `references/design-system.md` (read it first) and
in `references/tokens.md` here.

## Workflow

1. **Ask briefly** (one round, options welcome): brand or primary color, light/dark
   preference, roundness (sharp / default / soft), density (compact / default / roomy),
   font (system default, or a font name the user already has locally), anything they
   dislike in the current artifacts.
2. **Preview first.** Write the style guide as an artifact so changes are visible:
   `artifact_template` `get` `style-guide`, then `artifact_write` it (title "Style guide").
   Share the Open link.
3. **Edit `theme.css`.** Override only what changes, for both `:root` and `.dark`.
   Use OKLCH like the defaults and keep contrast: text on `primary` must stay readable
   (aim for ≥ 4.5:1). Chart colors must stay distinguishable from each other in both
   themes.
4. **Check.** Reload the style guide (it reloads automatically) and look at one or two
   real artifacts in both themes. Adjust.
5. **Record.** Update `DESIGN.md`: what was decided and why, in a few bullets, plus any
   new rules ("Use `secondary` badges for drafts").
6. **Summarise** what changed, and mention that existing artifacts pick it up immediately
   and exports made from now on include it.

## Maintaining over time

- When the user corrects the look of a specific artifact ("too much color", "use our
  green"), decide whether it is a one-off or a rule. Rules go into `DESIGN.md` (and
  `theme.css` if they are tokens) so every future artifact follows them.
- Keep `DESIGN.md` under ~60 lines; merge or delete outdated rules instead of appending.
- To reset, delete `theme.css` (or the whole `.design` folder).

## theme.css example

```css
:root {
	--primary: oklch(0.55 0.2 260);          /* brand blue */
	--primary-foreground: oklch(0.98 0 0);
	--radius: 0.375rem;                       /* sharper */
	--chart-1: oklch(0.55 0.2 260);
	--chart-2: oklch(0.7 0.15 180);
}
.dark {
	--primary: oklch(0.7 0.16 260);
	--primary-foreground: oklch(0.15 0 0);
	--chart-1: oklch(0.7 0.16 260);
	--chart-2: oklch(0.75 0.13 180);
}
body { font-family: "Inter", ui-sans-serif, system-ui, sans-serif; } /* only if installed */
```

## DESIGN.md skeleton

```markdown
# Design decisions

## Brand
- Primary: brand blue (oklch 0.55 0.2 260). Accent only for the main action and active states.

## Rules
- Dashboards: max 3 KPI cards, chart before table.
- Status badges: default = done, secondary = in progress, destructive = blocked.

## Don't
- No pie charts. No emoji in titles.
```
