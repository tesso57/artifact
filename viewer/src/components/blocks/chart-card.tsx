import type { CSSProperties, ReactElement, ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Series colors from the theme (light/dark aware). */
export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** Spread onto recharts <XAxis>/<YAxis> for themed, quiet axes. */
export const axisProps = {
	tickLine: false,
	axisLine: false,
	tickMargin: 8,
	stroke: "var(--muted-foreground)",
	fontSize: 12,
} as const;

/** Spread onto recharts <CartesianGrid>. */
export const gridProps = { vertical: false, stroke: "var(--border)" } as const;

/** Spread onto recharts <Tooltip>. */
export const tooltipProps = {
	contentStyle: {
		background: "var(--popover)",
		border: "1px solid var(--border)",
		borderRadius: 8,
		color: "var(--popover-foreground)",
		fontSize: 12,
	} satisfies CSSProperties,
	cursor: { fill: "var(--muted)", opacity: 0.5 },
} as const;

/**
 * Card with a responsive recharts chart. `children` is one recharts chart element.
 *
 *   <ChartCard title="Revenue"><AreaChart data={rows}>…</AreaChart></ChartCard>
 */
export function ChartCard({
	title,
	description,
	action,
	height = 256,
	className,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	height?: number;
	className?: string;
	children: ReactElement;
}) {
	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{description && <CardDescription>{description}</CardDescription>}
				{action && <CardAction>{action}</CardAction>}
			</CardHeader>
			<CardContent className={cn("min-w-0")} style={{ height }}>
				<ResponsiveContainer width="100%" height="100%">
					{children}
				</ResponsiveContainer>
			</CardContent>
		</Card>
	);
}
