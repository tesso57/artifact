---
name: artifact-template-creator
description: Design and save a reusable artifact template together with the user by interviewing them about their use case step by step (who uses it, what data, what decisions, layout), then building, previewing and refining it. Use when the user wants a template, a reusable starting point, or "the same kind of page again for other data", or asks to improve an existing template.
---

# Artifact template creator

A template is a reusable artifact (`template.tsx`) plus metadata (`title`, `description`,
`useCases`, `tags`) saved with `artifact_template` `save` under
`~/.pi/artifacts/.templates/<name>/`. The `artifacts` skill picks templates by their
`useCases`, so those must describe real requests.

Read the `artifacts` skill first (its rules, `references/components.md` and the design
system) — templates follow the same contract.

## Run it as an interview

Work in short rounds. Each round: ask **at most 2–3 questions**, offer concrete options
(a, b, c) the user can pick from, and summarise what you understood before moving on.
Never ask for something you can find out yourself (existing templates, MCP tools, data
shapes). Stop asking as soon as you can build something useful — a preview the user can
react to beats more questions.

### Round 1 — The job

- Who uses it, and in what moment? ("Monday stand-up", "when a customer emails").
- What decision or action should it make easier?
- How often, and does it need to remember anything between visits?

Before round 2, call `artifact_template` `list`: if an existing template is close, propose
extending or forking it instead of starting over.

### Round 2 — The data

- Where does the data come from? Look for MCP tools yourself (tool search) and propose the
  matching ones; call one once to see the real shape.
- What are the key fields, and which numbers matter most?
- What should vary between uses of the template (repo, date range, team, threshold)?
  These become the `CONFIG` block.

### Round 3 — The shape

Propose a layout as a small ASCII wireframe built from the blocks, for example:

```
┌ PageHeader: title · [7d|30d] ───────────────┐
│ StatCard  StatCard  StatCard                │
│ ChartCard (trend over time)                 │
│ Section: DataTable (sortable, row → dialog) │
└─────────────────────────────────────────────┘
```

Ask what to add, drop or reorder. Confirm interactions (filters, row click, actions,
what is remembered with `useMemory`).

### Round 4 — Build and preview

Write the template following `references/authoring.md`, then:

```
artifact_template save  name, title, description, useCases, tags, code, preview: true
```

Fix compile errors and save again. Share the preview URL and ask for feedback on
specific things (layout, wording, missing data, states).

### Round 5 — Refine and finish

Apply feedback (save again, same name). When the user is happy, summarise the template:
name, what it is for, what to change in `CONFIG`, and an example request that will pick it
("make me a … like the stand-up board").

## Improving an existing template

`artifact_template` `get` it, ask what felt wrong last time it was used, then follow
rounds 3–5. Saving a bundled template's name creates a user copy that overrides it.

See `references/interview.md` for a question bank and examples of good `useCases`.
