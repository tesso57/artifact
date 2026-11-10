import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GanttChart } from "../../../viewer/src/components/blocks/gantt-chart";
import { Markdown } from "../../../viewer/src/components/blocks/markdown";
import { MutationError, QueryState } from "../../../viewer/src/components/blocks/query-state";
import { createColumns, DataTable, SortHeader } from "../../../viewer/src/components/blocks/data-table";

describe("content blocks", () => {
	it("announces the active sort order in data-table column headers", () => {
		const helper = createColumns<{ name: string }>();
		const columns = helper.columns([helper.accessor("name", { header: ({ column }) => createElement(SortHeader, { column, children: "Name" }) })]);
		const html = renderToStaticMarkup(createElement(DataTable<{ name: string }>, { data: [{ name: "Ada" }], columns, initialSort: { id: "name", desc: true } }));
		expect(html).toMatch(/<th[^>]*aria-sort="descending"/);
	});
	it("does not offer a network retry for a local empty-state callback error", () => {
		const html = renderToStaticMarkup(createElement(QueryState, {
			query: { data: [1], error: null, isPending: false, refetch: () => {} },
			isEmpty: () => { throw new Error("bad empty check"); },
			children: () => "content",
		}));
		expect(html).toContain("bad empty check");
		expect(html).not.toContain("Retry");
	});
	it("labels clearing a mutation error as dismissal, not a retry", () => {
		const html = renderToStaticMarkup(createElement(MutationError, { mutation: { error: new Error("Save failed"), reset: () => {} } }));
		expect(html).toContain("Dismiss");
		expect(html).not.toContain("Retry");
	});
	it("renders Markdown tables and task lists without interpreting raw HTML", () => {
		const html = renderToStaticMarkup(createElement(Markdown, { children: "# Plan\n\n| Task | Status |\n| --- | --- |\n| Draft | Done |\n\n- [x] Ready\n\n<script>alert(1)</script>" }));
		expect(html).toContain("<table");
		expect(html).toContain('type="checkbox"');
		expect(html).toMatch(/class="[^"]*contains-task-list[^"]*"/);
		expect(html).toMatch(/class="[^"]*list-disc[^"]*"/);
		expect(html).not.toContain("<script>");
	});

	it("gives task checkboxes names without including nested tasks", () => {
		const html = renderToStaticMarkup(createElement(Markdown, { children: "- [x] Check **design** and [notes](https://example.com)\n  - nested detail\n- [ ] Ship" }));
		expect(html).toMatch(/<input[^>]*aria-label="Check design and notes"/);
		expect(html).toMatch(/<input[^>]*aria-label="Ship"/);
		expect(html).not.toContain('aria-label="Check design and notes nested detail"');
	});

	it("renders task dates and progress, and reports invalid ranges", () => {
		const html = renderToStaticMarkup(createElement(GanttChart, { tasks: [
			{ id: "a", label: "Design", start: "2026-11-01", end: "2026-11-03", progress: 50 },
			{ id: "b", label: "Invalid", start: "2026-11-05", end: "2026-11-03" },
		] }));
		expect(html).toContain("Design");
		expect(html).toContain("50%");
		expect(html).toContain("Invalid");
		expect(html).toContain("Invalid date range");
		expect(html).toContain("Invalid date range: 2026-11-05 – 2026-11-03");
		expect(html).toContain('aria-label="Invalid: Invalid date range: 2026-11-05 – 2026-11-03"');
	});

	it("exposes timeline tasks as a named list with accessible summaries", () => {
		const html = renderToStaticMarkup(createElement(GanttChart, { tasks: [
			{ id: "design", label: "Design", start: "2026-11-01", end: "2026-11-03", progress: 50 },
		] }));
		expect(html).toContain('<ul aria-label="Tasks">');
		expect(html).toMatch(/<li[^>]*aria-label="Design: 2026-11-01 – 2026-11-03, 50% complete"/);
	});

	it("allows callers to distinguish multiple timelines by accessible name", () => {
		const html = renderToStaticMarkup(createElement(GanttChart, {
			"aria-label": "開発スケジュール",
			tasks: [{ id: "work", label: "実装", start: "2026-11-01", end: "2026-11-03" }],
		}));
		expect(html).toContain('role="region" aria-label="開発スケジュール"');
	});

	it("does not depict an unspecified completion percentage as complete", () => {
		const html = renderToStaticMarkup(createElement(GanttChart, { tasks: [
			{ id: "unknown", label: "Not measured", start: "2026-11-01", end: "2026-11-02" },
		] }));
		expect(html).not.toContain("bg-primary h-full");
		expect(html).not.toContain("100% complete");
	});

	it("reports invalid progress instead of depicting it as complete", () => {
		const html = renderToStaticMarkup(createElement(GanttChart, { tasks: [
			{ id: "over", label: "Over", start: "2026-11-01", end: "2026-11-02", progress: 150 },
			{ id: "under", label: "Under", start: "2026-11-01", end: "2026-11-02", progress: -1 },
			{ id: "nan", label: "Unknown", start: "2026-11-01", end: "2026-11-02", progress: NaN },
		] }));
		expect(html).toContain("Invalid progress: 150");
		expect(html).toContain("Invalid progress: -1");
		expect(html).toContain("Invalid progress: NaN");
		expect(html).not.toContain("100% complete");
		expect(html).not.toContain("bg-primary h-full");
	});

	it("labels both ends of a weekly timeline without duplicate ticks", () => {
		const html = renderToStaticMarkup(createElement(GanttChart, { tasks: [
			{ id: "week", label: "Week", start: "2026-11-01", end: "2026-11-07" },
		] }));
		const labels = [...html.matchAll(/<span[^>]*>(\d{4}-\d{2}-\d{2})<\/span>/g)].map((match) => match[1]);
		expect(labels[0]).toBe("2026-11-01");
		expect(labels.at(-1)).toBe("2026-11-07");
		expect(new Set(labels).size).toBe(labels.length);
	});

	it("renders a large task list without exceeding the argument limit", () => {
		const task = { id: "task", label: "Task", start: "2026-11-01", end: "2026-11-02" };
		const tasks = Array.from({ length: 150_000 }, (_, i) => ({ ...task, id: String(i) }));
		expect(() => renderToStaticMarkup(createElement(GanttChart, { tasks }))).not.toThrow();
	}, 20_000);

	it("styles all heading levels and leaves ordinary list items marked in mixed lists", () => {
		const html = renderToStaticMarkup(createElement(Markdown, { children: "#### Detail\n\n##### Subdetail\n\n###### Note\n\n- [x] Task\n- Ordinary item" }));
		expect(html).toMatch(/<h4 class="[^"]*font-semibold/);
		expect(html).toMatch(/<h5 class="[^"]*font-semibold/);
		expect(html).toMatch(/<h6 class="[^"]*font-semibold/);
		expect(html).toMatch(/<li class="[^"]*task-list-item[^"]*list-none/);
		expect(html).not.toContain("[&amp;:has(input)]:list-none");
	});
});
