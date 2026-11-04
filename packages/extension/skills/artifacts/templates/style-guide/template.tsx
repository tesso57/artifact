/**
 * Template: style guide — renders the design system's tokens and components so a
 * theme change (~/.pi/artifacts/.design/theme.css) can be reviewed in one place.
 */
import { Bell, Inbox } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { axisProps, CHART_COLORS, ChartCard, EmptyState, ErrorState, Grid, LoadingState, Page, PageHeader, Section, StatCard, gridProps } from "@/components/blocks";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SURFACES = [
	["background", "bg-background"],
	["card", "bg-card"],
	["muted", "bg-muted"],
	["accent", "bg-accent"],
	["primary", "bg-primary"],
	["secondary", "bg-secondary"],
	["destructive", "bg-destructive"],
	["border", "bg-border"],
] as const;

const CHART = [3, 5, 4, 7, 6].map((v, i) => ({ name: `S${i + 1}`, value: v }));

export default function StyleGuide() {
	return (
		<Page>
			<PageHeader
				eyebrow="Design system"
				title="Style guide"
				description="Tokens and components every artifact is built from. Toggle the theme to check dark mode."
				actions={
					<Tabs defaultValue="a">
						<TabsList>
							<TabsTrigger value="a">Tabs</TabsTrigger>
							<TabsTrigger value="b">In header</TabsTrigger>
						</TabsList>
					</Tabs>
				}
			/>

			<Section title="Color tokens" description="Surfaces and accents; use them via Tailwind classes.">
				<Grid cols={4}>
					{SURFACES.map(([name, cls]) => (
						<div key={name} className="overflow-hidden rounded-lg border">
							<div className={`${cls} h-14`} />
							<p className="px-3 py-2 font-mono text-xs">{name}</p>
						</div>
					))}
				</Grid>
				<div className="flex gap-2">
					{CHART_COLORS.map((c, i) => (
						<div key={c} className="flex-1 overflow-hidden rounded-lg border">
							<div className="h-8" style={{ background: c }} />
							<p className="px-2 py-1 font-mono text-xs">chart-{i + 1}</p>
						</div>
					))}
				</div>
			</Section>

			<Section title="Type scale">
				<Card>
					<CardContent className="space-y-3">
						<p className="text-2xl font-semibold tracking-tight">Page title — text-2xl</p>
						<p className="text-lg font-semibold tracking-tight">Section title — text-lg</p>
						<p className="text-sm">Body — text-sm. The quick brown fox jumps over the lazy dog.</p>
						<p className="text-muted-foreground text-sm">Secondary — text-muted-foreground</p>
						<p className="font-mono text-xs">mono-xs · 0123456789</p>
					</CardContent>
				</Card>
			</Section>

			<Section title="Data">
				<Grid cols={3}>
					<StatCard title="Revenue" value="$48,210" delta={8.2} hint="vs last month" />
					<StatCard title="Latency p95" value="212 ms" delta={-4.1} invert hint="lower is better" />
					<StatCard title="Loading" value="" loading />
				</Grid>
				<ChartCard title="Series colors" description="chart-1 … chart-5" height={200}>
					<BarChart data={CHART}>
						<CartesianGrid {...gridProps} />
						<XAxis dataKey="name" {...axisProps} />
						<YAxis width={24} {...axisProps} />
						{/* One bar per series color */}
						<Bar dataKey="value" radius={4} fill="var(--chart-1)" />
					</BarChart>
				</ChartCard>
			</Section>

			<Section title="Controls">
				<Card>
					<CardHeader>
						<CardTitle>Form</CardTitle>
						<CardDescription>Label above control, one primary action.</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-2">
							<Label htmlFor="sg-name">Name</Label>
							<Input id="sg-name" placeholder="Ada Lovelace" />
							<p className="text-muted-foreground text-xs">Helper text</p>
						</div>
						<div className="flex flex-col justify-end gap-3">
							<div className="flex items-center gap-2"><Checkbox id="sg-c" defaultChecked /><Label htmlFor="sg-c">Checkbox</Label></div>
							<div className="flex items-center gap-2"><Switch id="sg-s" defaultChecked /><Label htmlFor="sg-s">Switch</Label></div>
						</div>
						<Progress value={62} className="sm:col-span-2" />
						<div className="flex flex-wrap gap-2 sm:col-span-2">
							<Button>Primary</Button>
							<Button variant="outline">Outline</Button>
							<Button variant="secondary">Secondary</Button>
							<Button variant="ghost">Ghost</Button>
							<Button variant="destructive">Delete</Button>
						</div>
						<div className="flex flex-wrap gap-2 sm:col-span-2">
							<Badge>active</Badge>
							<Badge variant="secondary">pending</Badge>
							<Badge variant="outline">inactive</Badge>
							<Badge variant="destructive">failed</Badge>
						</div>
					</CardContent>
				</Card>
			</Section>

			<Section title="States" description="Loading, empty, error and notice.">
				<Grid cols={2}>
					<Card><CardContent><LoadingState /></CardContent></Card>
					<EmptyState icon={<Inbox />} title="No messages" description="New messages show up here." action={<Button size="sm" variant="outline">Refresh</Button>} />
					<ErrorState error={new Error("github.list_issues: 401 Unauthorized")} title="Could not load issues" onRetry={() => {}} />
					<Alert>
						<Bell />
						<AlertTitle>Heads up</AlertTitle>
						<AlertDescription>Notices use the default alert.</AlertDescription>
					</Alert>
				</Grid>
			</Section>
		</Page>
	);
}
