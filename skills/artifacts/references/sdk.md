# `@pi/artifact`

```tsx
import { useMemory, useMemoryList, memory, useMcp, useMcpMutation, callMcp, useMcpTools, useMcpStatus, useArtifact, runtimeMode } from "@pi/artifact";
```

## Memory (SQLite)

- `const [value, setValue, { loading, error }] = useMemory<T>(key, initial, { scope? })` —
  like `useState`, persisted. `setValue` accepts a value or an updater. Scope defaults to
  the artifact; `{ scope: "shared" }` is shared by all artifacts.
- `initial` may be `undefined`, e.g. `useMemory<string | undefined>("selection", undefined)`.
  Setting `undefined` removes the key and restores the initial value.
  When a key is missing, each hook uses its own initial value; a saved value is shared.
- `useMemoryList({ scope?, prefix? })` — a query of `{ key, value, updatedAt }[]`, ordered by
  the UTF-8 bytes of each key in both the live viewer and offline exports.
- `memory.get/set/delete/list(scope, …)` — imperative, outside render.
- `memory.set` snapshots its JSON-serializable value when called; `undefined` deletes the key. Invalid values reject the returned promise.
- Check `loading` and `error` before treating the default value as saved data. In an offline
  export, inaccessible or malformed browser storage reports an error instead of silently
  replacing saved values; a functional update can retry the read after storage recovers.
- A write error remains visible even if another already-queued write succeeds. It clears when
  the user starts another update to that key; the failed action is not automatically replayed.
  If a live write's response is lost, it may already have completed: refresh the displayed
  value before deciding whether to retry.
- Functional updates compare the saved value and retry on conflicts, including concurrent
  tabs and agent writes. Keep updater functions pure because a conflict can re-evaluate them;
  repeated conflicts eventually report an error. In exported HTML, writes use IndexedDB
  to coordinate tabs of the same export; separate exports do not block one another. If
  IndexedDB is unavailable, writes report an error instead of risking data loss. Direct value
  assignments intentionally replace the current value.
- The agent reads and writes the same store with `artifact_memory`, so memory is also the
  way to hand data from the conversation to an artifact (and back).
- `artifact_memory` with `get` reports a missing key separately from a stored JSON `null`.
- `artifact_memory` with `set` requires a value (use `null` for JSON null); use `delete` to remove a key.
- Values are JSON (`null` is a value; `memory.delete` removes a key). The agent's writes
  appear in open tabs immediately. Keep them small (settings, entries, cached summaries); store one key per
  collection (`"todos"`) rather than one key per item unless items are large.
- `useMemory` validates and normalizes values as JSON before displaying or writing them;
  unsupported values such as `BigInt` report an error without changing the saved value.
- New memory keys must be non-empty, valid Unicode, at most 512 UTF-16 code units, and not `"*"`.
  Older longer keys remain readable and removable.
- Scopes use lowercase letters, digits and hyphens, start with a letter or digit, and are at most 64 characters.
  A template preview's default scope adds `template-` before its name and may be longer;
  use that full scope with `artifact_memory` to inspect or update preview data.

## MCP (through pi)

- Names: `"server.tool"` or `"mcp__server__tool"`.
- **Allowlist:** an artifact may only call the tools listed in `artifact_write`'s `mcp`
  parameter (`"server.tool"` or `"server.*"`). Anything else fails with an
  "allowlist" error — add the tool and write again.
- **Approval:** a tool runs unasked only when its server marks it read-only and
  closed-world; otherwise pi asks the user once per tool per session. Put writes behind a
  button (`useMcpMutation`) so the prompt appears when the user acts.
- `useMcp<T>(name, args, queryOptions?)` → TanStack Query result whose `data` is
  `{ text, data: T }`: `data` is the server's `structuredContent`, or the text parsed as
  JSON when it can be represented, else `undefined` (use `text`). Numbers outside
  JavaScript's finite range and integers outside its safe range are not exposed as parsed data;
  a nonzero JSON text number that underflows to zero is also left as text. Use the returned
  text when the server provides an exact representation; already-parsed structured data
  may have lost precision before it reaches the viewer.
- MCP queries do not automatically retry after errors or refetch on remount, focus or reconnect by
  default. Enable those query options only when repeating the tool is safe.
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
read, and the latest successful MCP result the viewer fetched for each currently allowlisted tool +
arguments. A new call clears its previous result; pending or failed calls have no offline result.
Rewriting an artifact also clears its MCP snapshot; reload the artifact to fetch fresh data.
Saving a template refreshes an open preview's MCP data while preserving its preview memory.
Calls with other arguments also fail offline. The tool result lists what was embedded — tell the user
before they share the file. Open the artifact in the viewer first so its data is loaded,
and keep MCP arguments deterministic.
