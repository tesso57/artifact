/**
 * Always-on guidance for artifact_write. The details (components, TanStack, SDK, design
 * system, templates) live in the `artifacts` skill, loaded only when needed.
 */
export const ARTIFACT_GUIDELINES = [
	"Use artifact_write when the user wants something visual or interactive (dashboard, tool, chart, tracker, report, prototype) to open in the browser, instead of a standalone HTML file. Load the artifacts skill first if it is not loaded yet.",
	'artifact_write code is one TSX module with a default-exported React component, styled with Tailwind theme tokens and shadcn/ui ("@/components/ui/*"), built from blocks ("@/components/blocks": Page, PageHeader, Section, Grid, StatCard, ChartCard, DataTable, QueryState, McpQuery). Persist state with useMemory and call pi\'s MCP tools with useMcp from "@pi/artifact". TanStack Table is v9 (useTable), not v8.',
	"After artifact_write, fix any compile error it reports and write again; for small follow-ups edit the returned index.tsx file instead.",
];
