import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * KPI card: label, big value, optional % delta (green up / red down) and hint.
 * Pass `loading` while the value's query is pending.
 */
export function StatCard({
	title,
	value,
	delta,
	hint,
	icon: Icon,
	loading,
	invert,
	className,
}: {
	title: string;
	value: ReactNode;
	/** Percent change, e.g. 8.2 or -1.5. */
	delta?: number;
	hint?: ReactNode;
	icon?: LucideIcon;
	loading?: boolean;
	/** For metrics where down is good (costs, latency). */
	invert?: boolean;
	className?: string;
}) {
	const good = delta === undefined ? undefined : invert ? delta <= 0 : delta >= 0;
	return (
		<Card className={cn("gap-2", className)}>
			<CardHeader>
				<CardDescription>{title}</CardDescription>
				{Icon && (
					<CardAction>
						<Icon className="text-muted-foreground size-4" />
					</CardAction>
				)}
				<CardTitle className="text-2xl tabular-nums">{loading ? <Skeleton className="h-8 w-24" /> : value}</CardTitle>
			</CardHeader>
			{(delta !== undefined || hint) && (
				<CardContent className="text-muted-foreground flex items-center gap-2 text-xs">
					{delta !== undefined && !loading && (
						<span className={cn("flex items-center gap-0.5 font-medium", good ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
							{delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
							{Math.abs(delta).toFixed(1)}%
						</span>
					)}
					{hint}
				</CardContent>
			)}
		</Card>
	);
}
