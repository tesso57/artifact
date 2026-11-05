/**
 * Template: KPI dashboard — StatCards, a themed area chart (ChartCard), and a
 * sortable, searchable DataTable; the date range is remembered in memory.
 *
 * Adapt: replace CONFIG and the two data sources. For live data, wrap sections in
 * <McpQuery tool="server.tool"> or use useMcp() and pass `loading={q.isPending}`.
 */
import { useMemory } from "@pi/artifact";
import { DollarSign, ShoppingCart, Users } from "lucide-react";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, ChartCard, createColumns, DataTable, gridProps, SortHeader, StatCard, tooltipProps } from "@/components/blocks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ---- CONFIG: what this dashboard is about --------------------------------------
const CONFIG = { title: "Store overview", currency: "USD", ranges: ["7", "14", "30"] as const };

type Day = { date: string; revenue: number; orders: number; visitors: number };
type Product = { name: string; category: string; sales: number; growth: number };

// ---- DATA: sample data; replace with MCP results or computed values -------------
const DAYS: Day[] = Array.from({ length: 30 }, (_, i) => ({
	date: `11/${String(i + 1).padStart(2, "0")}`,
	revenue: Math.round(4000 + Math.sin(i / 4) * 1200 + i * 60),
	orders: Math.round(90 + Math.cos(i / 5) * 20 + i),
	visitors: Math.round(1800 + Math.sin(i / 3) * 300 + i * 12),
}));
const PRODUCTS: Product[] = [
	{ name: "Aurora Lamp", category: "Home", sales: 18240, growth: 12.4 },
	{ name: "Trail Pack 30L", category: "Outdoor", sales: 15110, growth: -3.1 },
	{ name: "Pour-over Kit", category: "Kitchen", sales: 12980, growth: 8.7 },
	{ name: "Linen Throw", category: "Home", sales: 9870, growth: 21.0 },
	{ name: "Desk Mat XL", category: "Office", sales: 7420, growth: 4.2 },
];

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: CONFIG.currency, maximumFractionDigits: 0 });
const num = new Intl.NumberFormat();

const col = createColumns<Product>();
const columns = col.columns([
	col.accessor("name", { header: ({ column }) => <SortHeader column={column}>Product</SortHeader>, cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
	col.accessor("category", { header: "Category", cell: (c) => <Badge variant="outline">{c.getValue()}</Badge> }),
	col.accessor("sales", { header: ({ column }) => <SortHeader column={column}>Sales</SortHeader>, cell: (c) => <span className="tabular-nums">{money.format(c.getValue())}</span> }),
	col.accessor("growth", {
		header: ({ column }) => <SortHeader column={column}>Growth</SortHeader>,
		cell: (c) => {
			const v = c.getValue();
			return <span className={v >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>{v > 0 ? "+" : ""}{v.toFixed(1)}%</span>;
		},
	}),
]);

export default function Dashboard() {
	const [range, setRange] = useMemory<(typeof CONFIG.ranges)[number]>("range", "30");
	const days = useMemo(() => DAYS.slice(-Number(range)), [range]);
	const sum = (k: "revenue" | "orders" | "visitors") => days.reduce((s, d) => s + d[k], 0);

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-6">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">{CONFIG.title}</h1>
					<p className="text-muted-foreground text-sm">Last {range} days</p>
				</div>
				<Tabs value={range} onValueChange={(v) => setRange(v as typeof range)}>
					<TabsList>
						{CONFIG.ranges.map((r) => <TabsTrigger key={r} value={r}>{r}d</TabsTrigger>)}
					</TabsList>
				</Tabs>
			</div>

			<div className="grid gap-4 sm:grid-cols-3">
				<StatCard title="Revenue" value={money.format(sum("revenue"))} delta={8.2} hint="vs previous period" icon={DollarSign} />
				<StatCard title="Orders" value={num.format(sum("orders"))} delta={3.4} hint="vs previous period" icon={ShoppingCart} />
				<StatCard title="Visitors" value={num.format(sum("visitors"))} delta={-1.8} hint="vs previous period" icon={Users} />
			</div>

			<ChartCard title="Revenue" description={`Daily, in ${CONFIG.currency}`}>
				<AreaChart data={days} margin={{ left: 0, right: 8 }}>
					<defs>
						<linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
							<stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
							<stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
						</linearGradient>
					</defs>
					<CartesianGrid {...gridProps} />
					<XAxis dataKey="date" {...axisProps} minTickGap={24} />
					<YAxis width={48} {...axisProps} tickFormatter={(v) => `${v / 1000}k`} />
					<Tooltip {...tooltipProps} formatter={(v) => money.format(Number(v))} />
					<Area type="monotone" dataKey="revenue" stroke="var(--chart-1)" strokeWidth={2} fill="url(#fillRevenue)" />
				</AreaChart>
			</ChartCard>

			<Card>
				<CardHeader>
					<CardTitle>Top products</CardTitle>
				</CardHeader>
				<CardContent>
					<DataTable data={PRODUCTS} columns={columns} initialSort={{ id: "sales", desc: true }} pageSize={0} />
				</CardContent>
			</Card>
		</div>
	);
}
