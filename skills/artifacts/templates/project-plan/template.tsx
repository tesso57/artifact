import { GanttChart, Markdown, Page, PageHeader, Section } from "@/components/blocks";

const tasks = [
	{ id: "discovery", label: "Discovery", start: "2026-11-02", end: "2026-11-06", progress: 100 },
	{ id: "design", label: "Design", start: "2026-11-05", end: "2026-11-13", progress: 65 },
	{ id: "build", label: "Build and review", start: "2026-11-12", end: "2026-11-27", progress: 20 },
	{ id: "launch", label: "Launch", start: "2026-11-30", end: "2026-11-30", progress: 0 },
] as const;
const brief = `## Project brief

Bring the team together around a **clear, shared plan**. Update the timeline as work moves forward.

### Next up

- [x] Agree on the project scope
- [ ] Review the first design
- [ ] Schedule the launch review

> Keep stakeholders informed when dates or priorities change.
`;

export default function ProjectPlan() {
	return <Page>
		<PageHeader eyebrow="PROJECT WORKSPACE" title="Project plan" description="A shared view of the work ahead." />
		<Section title="Timeline" description="Dates are inclusive; the filled portion shows progress.">
			<GanttChart tasks={tasks} />
		</Section>
		<Section title="Brief" description="Context and next steps for the team.">
			<div className="bg-card rounded-lg border p-6"><Markdown>{brief}</Markdown></div>
		</Section>
	</Page>;
}
