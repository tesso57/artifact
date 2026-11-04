/**
 * Template: searchable, sortable, paginated records with a filter in the toolbar
 * (remembered in memory) and a detail dialog on row click.
 *
 * Adapt: replace `Row`, `ROWS` (or fetch with useMcp / <McpQuery>) and the columns.
 */
import { useMemory } from "@pi/artifact";
import { useMemo, useState } from "react";
import { createColumns, DataTable, SortHeader } from "@/components/blocks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Row = { id: string; name: string; email: string; role: "Admin" | "Editor" | "Viewer"; status: "active" | "invited" | "disabled" };

const ROLES = ["Admin", "Editor", "Viewer"] as const;
const STATUSES = ["active", "invited", "disabled"] as const;
const ROWS: Row[] = Array.from({ length: 48 }, (_, i) => ({
	id: String(i + 1),
	name: ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Linus Torvalds", "Margaret Hamilton", "Ken Thompson"][i % 6] + (i >= 6 ? ` ${Math.floor(i / 6) + 1}` : ""),
	email: `user${i + 1}@example.com`,
	role: ROLES[i % 3],
	status: STATUSES[(i * 7) % 3],
}));
const STATUS_VARIANT = { active: "default", invited: "secondary", disabled: "outline" } as const;

const col = createColumns<Row>();
const columns = col.columns([
	col.accessor("name", { header: ({ column }) => <SortHeader column={column}>Name</SortHeader>, cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
	col.accessor("email", { header: ({ column }) => <SortHeader column={column}>Email</SortHeader>, cell: (c) => <span className="text-muted-foreground">{c.getValue()}</span> }),
	col.accessor("role", { header: ({ column }) => <SortHeader column={column}>Role</SortHeader> }),
	col.accessor("status", { header: "Status", cell: (c) => <Badge variant={STATUS_VARIANT[c.getValue()]} className="capitalize">{c.getValue()}</Badge> }),
]);

export default function Records() {
	const [role, setRole] = useMemory<"all" | Row["role"]>("roleFilter", "all");
	const [open, setOpen] = useState<Row | null>(null);
	const rows = useMemo(() => (role === "all" ? ROWS : ROWS.filter((r) => r.role === role)), [role]);

	return (
		<Card className="mx-auto max-w-5xl">
			<CardHeader>
				<CardTitle>Team members</CardTitle>
				<CardDescription>{rows.length} people · click a row for details</CardDescription>
			</CardHeader>
			<CardContent>
				<DataTable
					data={rows}
					columns={columns}
					getRowId={(r) => r.id}
					initialSort={{ id: "name" }}
					searchPlaceholder="Search name, email…"
					onRowClick={setOpen}
					toolbar={
						<Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
							<SelectTrigger aria-label="Role filter" className="w-36"><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All roles</SelectItem>
								{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
							</SelectContent>
						</Select>
					}
				/>
			</CardContent>
			<Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{open?.name}</DialogTitle>
						<DialogDescription>{open?.email}</DialogDescription>
					</DialogHeader>
					<dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
						<dt className="text-muted-foreground">Role</dt><dd>{open?.role}</dd>
						<dt className="text-muted-foreground">Status</dt><dd className="capitalize">{open?.status}</dd>
					</dl>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
