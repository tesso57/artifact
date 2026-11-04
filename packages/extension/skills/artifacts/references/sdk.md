# `@pi/artifact`

```tsx
import { useMemory, useMemoryList, memory, useMcp, useMcpMutation, callMcp, useMcpTools, useMcpStatus, useArtifact, runtimeMode } from "@pi/artifact";
```

## Memory (SQLite)

- `const [value, setValue, { loading, error }] = useMemory<T>(key, initial, { scope? })` —
  like `useState`, persisted. `setValue` accepts a value or an updater. Scope defaults to
  the artifact; `{ scope: "shared" }` is shared by all artifacts.
- `useMemoryList({ scope?, prefix? })` — a query of `{ key, value, updatedAt }[]`.
- `memory.get/set/delete/list(scope, …)` — imperative, outside render.
- The agent reads and writes the same store with `artifact_memory`, so memory is also the
  way to hand data from the conversation to an artifact (and back).
- Values are JSON. Keep them small (settings, entries, cached summaries); store one key per
  collection (`"todos"`) rather than one key per item unless items are large.

## MCP (through pi)

- Names: `"server.tool"` or `"mcp__server__tool"`.
- `useMcp<T>(name, args, queryOptions?)` → TanStack Query result whose `data` is
  `{ text, data: T }`: `data` is the server's `structuredContent`, or the text parsed as
  JSON when it looks like JSON, else `undefined` (use `text`).
- `useMcpMutation<T>(name)` → `mutate(args)` / `mutateAsync(args)` for actions.
- `await callMcp<T>(name, args)` — throws when the tool reports an error.
- `useMcpTools()` lists available tools; `useMcpStatus()` → `{ connected, ready }`.
  `ready` is false until the agent used an artifact tool in the current pi session.
- Calls go through pi's tool pipeline: permission prompts and hooks apply.

## Other

- `useArtifact()` → `{ id, title, description }`.
- `runtimeMode` is `"live"` in the viewer and `"static"` in an exported HTML file.

## Export (`artifact_export`)

One self-contained HTML file. Memory is snapshotted and then kept in the file's
localStorage; MCP calls replay the latest result the viewer fetched for the same tool and
arguments, and fail otherwise. So: open the artifact in the viewer (so its data loads)
before exporting, and keep MCP arguments deterministic.
