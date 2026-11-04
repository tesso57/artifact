import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Layout primitives of the artifact design system. Every artifact should be:
 *   <Page> <PageHeader …/> <Section …>…</Section> … </Page>
 * so spacing, widths and type scale stay consistent across artifacts.
 */

const WIDTHS = { sm: "max-w-xl", md: "max-w-3xl", lg: "max-w-5xl", xl: "max-w-6xl", full: "max-w-none" } as const;

export function Page({ width = "xl", className, children }: { width?: keyof typeof WIDTHS; className?: string; children: ReactNode }) {
	return <div className={cn("mx-auto flex w-full flex-col gap-8", WIDTHS[width], className)}>{children}</div>;
}

export function PageHeader({
	title,
	description,
	actions,
	eyebrow,
}: {
	title: ReactNode;
	description?: ReactNode;
	/** Buttons, tabs or filters, right-aligned on wide screens. */
	actions?: ReactNode;
	/** Small label above the title (category, date, source). */
	eyebrow?: ReactNode;
}) {
	return (
		<header className="flex flex-wrap items-end justify-between gap-4">
			<div className="min-w-0 space-y-1">
				{eyebrow && <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{eyebrow}</p>}
				<h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
				{description && <p className="text-muted-foreground text-sm text-pretty">{description}</p>}
			</div>
			{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
		</header>
	);
}

export function Section({
	title,
	description,
	actions,
	className,
	children,
}: {
	title?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section className={cn("flex flex-col gap-4", className)}>
			{(title || actions) && (
				<div className="flex flex-wrap items-end justify-between gap-2">
					<div className="space-y-1">
						{title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
						{description && <p className="text-muted-foreground text-sm">{description}</p>}
					</div>
					{actions && <div className="flex items-center gap-2">{actions}</div>}
				</div>
			)}
			{children}
		</section>
	);
}

const COLS = {
	1: "grid-cols-1",
	2: "grid-cols-1 sm:grid-cols-2",
	3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
	4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
} as const;

/** Responsive grid: collapses to one column on phones. */
export function Grid({ cols = 3, className, children }: { cols?: keyof typeof COLS; className?: string; children: ReactNode }) {
	return <div className={cn("grid gap-4", COLS[cols], className)}>{children}</div>;
}
