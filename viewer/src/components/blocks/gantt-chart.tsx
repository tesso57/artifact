import { cn } from "../../lib/utils";

/** Dates are inclusive calendar dates in YYYY-MM-DD format, independent of time zone. */
export interface GanttTask {
	id: string;
	label: string;
	start: string;
	end: string;
	/** Completion percentage, from 0 to 100. */
	progress?: number;
}

const DAY = 86_400_000;
function dateValue(value: string): number | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
	const time = Date.parse(`${value}T00:00:00Z`);
	return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : undefined;
}

/** A read-only, horizontally scrollable timeline. Tasks with invalid dates remain visible. */
export function GanttChart({ tasks, className, empty = "No tasks.", "aria-label": label = "Gantt chart" }: { tasks: readonly GanttTask[]; className?: string; empty?: string; "aria-label"?: string }) {
	const rows = tasks.map((task) => {
		const start = dateValue(task.start);
		const end = dateValue(task.end);
		return { task, start, end, valid: start !== undefined && end !== undefined && end >= start };
	});
	const valid = rows.filter((row) => row.valid);
	let first = Infinity;
	let last = -Infinity;
	for (const row of valid) {
		first = Math.min(first, row.start!);
		last = Math.max(last, row.end!);
	}
	const days = valid.length ? (last - first) / DAY + 1 : 1;
	const tickCount = Math.min(days, 4);
	const ticks = Array.from({ length: tickCount }, (_, i) => tickCount === 1 ? 0 : Math.round(i * (days - 1) / (tickCount - 1)));
	const format = (time: number) => new Date(time).toISOString().slice(0, 10);

	if (!rows.length) return <p className={cn("text-muted-foreground text-sm", className)}>{empty}</p>;
	return (
		<div className={cn("overflow-x-auto rounded-lg border", className)} role="region" aria-label={label} tabIndex={0}>
			<div className="min-w-[720px]">
				<div className="bg-muted/50 text-muted-foreground flex border-b text-xs font-medium">
					<div className="w-56 shrink-0 px-4 py-3">Task</div>
					<div className="relative h-10 grow border-l" aria-hidden="true">
						{valid.length > 0 && ticks.map((day) => {
							const lastTick = days > 1 && day === days - 1;
							return <span key={day} className={cn("absolute top-3 whitespace-nowrap", lastTick ? "-translate-x-full pr-2" : "pl-2")} style={{ left: `${lastTick ? 100 : day / days * 100}%` }}>{format(first + day * DAY)}</span>;
						})}
					</div>
				</div>
				<ul aria-label="Tasks">
				{rows.map(({ task, start, end, valid: isValid }) => {
					const invalidProgress = task.progress !== undefined && (!Number.isFinite(task.progress) || task.progress < 0 || task.progress > 100);
					const progress = invalidProgress ? undefined : task.progress;
					const dates = `${task.start || "(missing)"} – ${task.end || "(missing)"}`;
					const progressDetail = invalidProgress ? `Invalid progress: ${task.progress}` : progress === undefined ? "" : `${progress}%`;
					const detail = `${isValid ? dates : `Invalid date range: ${dates}`}${progressDetail ? ` · ${progressDetail}` : ""}`;
					const summary = isValid && !invalidProgress ? `${task.label}: ${dates}${progress === undefined ? "" : `, ${progress}% complete`}` : `${task.label}: ${detail}`;
					return <li key={task.id} className="flex min-h-14 border-b last:border-b-0" aria-label={summary}>
						<div className="w-56 shrink-0 px-4 py-2 text-sm"><div className="break-words font-medium">{task.label}</div><div className="text-muted-foreground break-words text-xs">{detail}</div></div>
						<div className="relative grow border-l" aria-hidden="true">
							{isValid && <div className="bg-primary/20 absolute top-1/2 h-5 -translate-y-1/2 overflow-hidden rounded" style={{ left: `${(start! - first) / DAY / days * 100}%`, width: `${((end! - start!) / DAY + 1) / days * 100}%` }}>{progress !== undefined && <div className="bg-primary h-full rounded" style={{ width: `${progress}%` }} />}</div>}
						</div>
					</li>;
				})}
				</ul>
			</div>
		</div>
	);
}
