/**
 * Always-on guidance for artifact_write. The details (components, TanStack, SDK, design
 * system, templates) live in the `artifacts` skill, loaded only when needed.
 */
export const ARTIFACT_GUIDELINES = [
	"Use artifact_write when the user wants something visual or interactive (dashboard, tool, chart, tracker, report, prototype) to open in the browser, instead of a standalone HTML file. Load the artifacts skill first if it is not loaded yet.",
	'artifact_write code is one TSX module with a default-exported React component, styled with Tailwind theme tokens and shadcn/ui ("@/components/ui/*"), built from blocks ("@/components/blocks": Page, PageHeader, Section, Grid, StatCard, ChartCard, DataTable, QueryState, McpQuery). Persist state with useMemory and call MCP tools with useMcp from "@pi/artifact"; list every MCP tool the code calls in artifact_write\'s mcp parameter. TanStack Table is v9 (useTable), not v8.',
	"artifact_write returns an Open link to give the user, and compile or runtime errors to fix by writing again (pass the same id). Omitting id always creates a new artifact.",
];
