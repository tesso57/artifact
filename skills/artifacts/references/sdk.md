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
- Values are JSON (`null` is a value; `memory.delete` removes a key). The agent's writes
  appear in open tabs immediately. Keep them small (settings, entries, cached summaries); store one key per
  collection (`"todos"`) rather than one key per item unless items are large.

## MCP (through pi)

- Names: `"server.tool"` or `"mcp__server__tool"`.
- **Allowlist:** an artifact may only call the tools listed in `artifact_write`'s `mcp`
  parameter (`"server.tool"`, `"server.*"`, `"*"`). Anything else fails with an
  "allowlist" error — add the tool and write again.
- **Approval:** a tool runs unasked only when its server marks it read-only and
  closed-world; otherwise pi asks the user once per tool per session. Put writes behind a
  button (`useMcpMutation`) so the prompt appears when the user acts.
- `useMcp<T>(name, args, queryOptions?)` → TanStack Query result whose `data` is
  `{ text, data: T }`: `data` is the server's `structuredContent`, or the text parsed as
  JSON when it looks like JSON, else `undefined` (use `text`).
- `useMcpMutation<T>(name)` → `mutate(args)` / `mutateAsync(args)` for actions.
- `await callMcp<T>(name, args)` — throws when the tool reports an error.
- `useMcpTools()` lists available tools (with `readOnly`); `useMcpStatus()` →
  `{ connected }` (whether any pi session is attached to the viewer). MCP works once the
  agent has used an artifact tool in that pi session.
- Calls go through pi's tool pipeline: permission prompts and hooks apply.

## Other

- `useArtifact()` → `{ id, title, description }`.
- `runtimeMode` is `"live"` in the viewer and `"static"` in an exported HTML file.

## Export (`artifact_export`)

One self-contained HTML file. It embeds the artifact's own memory, the shared keys it
read, and the latest MCP result the viewer fetched for each tool + arguments (calls with
other arguments fail offline). The tool result lists what was embedded — tell the user
before they share the file. Open the artifact in the viewer first so its data is loaded,
and keep MCP arguments deterministic.
