# pi-artifacts

Live, interactive **React artifacts** for the [pi coding agent](https://pi.dev).
Ask pi for a dashboard, a tool or a prototype; it writes a TSX component and you get a
URL that hot-reloads as the agent iterates.

- **One Vite server, many artifacts** — a single TanStack Start dev server serves every
  artifact as a route (`/a/<id>`), with HMR / React Fast Refresh. No iframes: artifacts
  are real modules in the app.
- **shadcn/ui + Tailwind v4** preinstalled (plus lucide icons, recharts, TanStack
  Query and TanStack Table v9), light and dark themes.
- **SQLite memory** — `useMemory()` persists state (Node's built-in `node:sqlite`); the
  agent reads/writes the same store with `artifact_memory`.
- **MCP from artifacts** — `useMcp("server.tool", args)` calls any MCP server connected to
  pi, through pi's own tool pipeline (hooks and permission gates apply).
- **vitest** for unit tests, plus an end-to-end test that drives a real pi session.

```
pi-artifacts/
├── packages/extension/   pi extension: artifact_write, artifact_memory, /artifacts, MCP bridge
├── packages/core/        shared: artifact store, SQLite memory, bridge types
├── apps/viewer/          TanStack Start app: gallery, artifact page, @pi/artifact SDK, shadcn/ui
└── test/e2e/             real pi session + faux model + stdio MCP server + Playwright
```

## Install

Requires Node 22.13+ (for `node:sqlite`).

```bash
git clone <this repo> pi-artifacts && cd pi-artifacts
npm install
pi install ./packages/extension
```

Or try it without installing: `pi -e ./packages/extension`.

## Use

Ask pi something like _"make an artifact that charts my open GitHub issues per label"_.
The agent calls `artifact_write`; the footer shows `◆ artifacts http://127.0.0.1:5178`.

| | |
|---|---|
| `/artifacts` | pick an artifact (or the gallery) and open it in the browser |
| `/artifacts <id>` | open one artifact |
| `/artifacts delete <id>` | delete an artifact |
| `/artifacts stop` | stop the viewer |

Artifacts are stored in `~/.pi/artifacts/<id>/{index.tsx,meta.json}` and memory in
`~/.pi/artifacts/.memory.sqlite`. Override with `PI_ARTIFACTS_DIR` / `PI_ARTIFACTS_DB`;
`PI_ARTIFACTS_PORT` sets the first port to try (default 5178).

You can also run the viewer alone (`npm run dev`) to browse artifacts; MCP calls then
report that pi is offline.

## Writing artifacts

An artifact is one TSX module with a default-exported component:

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMcp, useMemory } from "@pi/artifact";

export default function Issues() {
	const [label, setLabel] = useMemory("label", "bug");          // SQLite-backed state
	const issues = useMcp<{ title: string }[]>("github.list_issues", { label }); // MCP via pi
	return (
		<Card className="mx-auto max-w-xl">
			<CardHeader><CardTitle>Issues: {label}</CardTitle></CardHeader>
			<CardContent>
				{issues.isPending ? "Loading…" : issues.data?.data.map((i) => <p key={i.title}>{i.title}</p>)}
				<Button onClick={() => setLabel("feature")}>Show features</Button>
			</CardContent>
		</Card>
	);
}
```

### `@pi/artifact`

| API | |
|---|---|
| `useMemory(key, initial, { scope? })` | `[value, setValue, { loading, error }]`, persisted. Scope defaults to the artifact; `"shared"` is shared by all artifacts |
| `useMemoryList({ scope?, prefix? })`, `memory.get/set/delete/list(scope, …)` | lower-level memory access |
| `useMcp(name, args, queryOptions?)` | TanStack Query over an MCP tool: `{ data: { text, data }, isPending, error, refetch }` |
| `useMcpMutation(name)`, `callMcp(name, args)` | on-demand calls |
| `useMcpTools()`, `useMcpStatus()` | available MCP tools; bridge state |
| `useArtifact()` | `{ id, title, description }` |

MCP tool names are `"server.tool"` or `"mcp__server__tool"`. `data` is the server's
`structuredContent`, or the text result parsed as JSON when it looks like JSON.

## How it works

```
 pi process                                   browser
 ┌──────────────────────────────┐            ┌─────────────────────────┐
 │ extension                    │            │ /a/<id>  (TanStack       │
 │  artifact_write ─ writes ─► ~/.pi/artifacts ◄── Router route,       │
 │  ctx.executeTool(mcp__…) ◄─┐ │            │   dynamic import + HMR)  │
 │  bridge 127.0.0.1:<rand> ──┘ │            └───────────┬─────────────┘
 └──────────────┬───────────────┘                        │ server functions
                │ spawns, env: bridge URL + token        ▼
                └──────────────► viewer (vite dev, TanStack Start)
                                  memory → node:sqlite, MCP → bridge
```

- The bridge listens on loopback with a random token, and only runs `mcp__*` tools —
  artifacts cannot reach `bash`, `edit` or `write`.
- MCP calls use the tool context of the latest `artifact_write`/`artifact_memory` call
  (`ctx.executeTool`), so they go through pi's hooks; before the agent has used an
  artifact tool in the session, MCP calls answer "not ready".
- `artifact_write` asks Vite to transform the module and returns syntax errors and
  unresolved imports to the agent, so it can fix them before you look.
- The viewer is started on first use and stopped on `session_shutdown` (and when pi exits).

## Develop

```bash
npm test            # vitest (core + extension)
npm run test:e2e    # real pi session, faux model, MCP server, Playwright (needs playwright + chromium)
npm run typecheck
npm run dev         # viewer alone
```
