import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMcp, useMcpMutation, useMemory } from "@pi/artifact";
import { useState } from "react";

type Stats = { stars: number; issues: { day: string; open: number }[] };

export default function McpDemo() {
	const stats = useMcp<Stats>("echo.stats");
	const reverse = useMcpMutation("echo.reverse");
	const [text, setText] = useState("hello pi");
	const [history, setHistory] = useMemory<string[]>("history", []);

	return (
		<div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Open issues</CardTitle>
					<CardDescription>From the <code>echo</code> MCP server via pi</CardDescription>
				</CardHeader>
				<CardContent>
					{stats.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
					{stats.error && <p className="text-destructive text-sm">{String(stats.error)}</p>}
					{stats.data && (
						<>
							<Badge variant="secondary" className="mb-4">★ {stats.data.data.stars}</Badge>
							<div className="h-48">
								<ResponsiveContainer>
									<BarChart data={stats.data.data.issues}>
										<CartesianGrid vertical={false} strokeDasharray="3 3" />
										<XAxis dataKey="day" tickLine={false} axisLine={false} />
										<YAxis width={24} tickLine={false} axisLine={false} />
										<Bar dataKey="open" fill="var(--chart-2)" radius={4} />
									</BarChart>
								</ResponsiveContainer>
							</div>
						</>
					)}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Reverse text</CardTitle>
					<CardDescription>Calls <code>echo.reverse</code>, history saved in SQLite</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex gap-2">
						<Input value={text} onChange={(e) => setText(e.target.value)} />
						<Button
							disabled={reverse.isPending}
							onClick={async () => {
								const r = await reverse.mutateAsync({ text });
								setHistory((h) => [r.text, ...h].slice(0, 5));
							}}
						>
							Reverse
						</Button>
					</div>
					<ul className="space-y-1 text-sm" data-testid="history">
						{history.map((h, i) => (
							<li key={i} className="bg-muted rounded px-2 py-1 font-mono">{h}</li>
						))}
					</ul>
				</CardContent>
			</Card>
		</div>
	);
}
