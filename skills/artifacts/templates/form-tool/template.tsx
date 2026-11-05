/**
 * Template: interactive tool with a form — a habit tracker. Entries persist in
 * SQLite memory (useMemory), with a dialog, switch, progress and empty state.
 */
import { useMemory } from "@pi/artifact";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

type Habit = { id: string; name: string; done: boolean };

export default function HabitTracker() {
	const [habits, setHabits, { loading }] = useMemory<Habit[]>("habits", []);
	const [hideDone, setHideDone] = useMemory("hideDone", false);
	const [name, setName] = useState("");
	const [open, setOpen] = useState(false);

	const done = habits.filter((h) => h.done).length;
	const visible = hideDone ? habits.filter((h) => !h.done) : habits;

	const add = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		setHabits((hs) => [...hs, { id: crypto.randomUUID(), name: trimmed, done: false }]);
		setName("");
		setOpen(false);
	};

	return (
		<Card className="mx-auto max-w-md">
			<CardHeader>
				<CardTitle>Today's habits</CardTitle>
				<CardDescription>{habits.length ? `${done} of ${habits.length} done` : "Add your first habit"}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<Progress value={habits.length ? (done / habits.length) * 100 : 0} aria-label="Progress" />
				<div className="flex items-center justify-between">
					<Label htmlFor="hide-done">Hide completed</Label>
					<Switch id="hide-done" checked={hideDone} onCheckedChange={setHideDone} />
				</div>
				<Separator />
				{loading ? (
					<div className="space-y-2">
						<Skeleton className="h-8 w-full" />
						<Skeleton className="h-8 w-2/3" />
					</div>
				) : visible.length === 0 ? (
					<p className="text-muted-foreground py-6 text-center text-sm">{habits.length ? "All done 🎉" : "Nothing here yet."}</p>
				) : (
					<ul className="space-y-1">
						{visible.map((h) => (
							<li key={h.id} className="hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-1.5">
								<Checkbox
									id={h.id}
									checked={h.done}
									onCheckedChange={(v) => setHabits((hs) => hs.map((x) => (x.id === h.id ? { ...x, done: !!v } : x)))}
								/>
								<Label htmlFor={h.id} className={`flex-1 font-normal ${h.done ? "text-muted-foreground line-through" : ""}`}>{h.name}</Label>
								<Button variant="ghost" size="icon" aria-label={`Delete ${h.name}`} onClick={() => setHabits((hs) => hs.filter((x) => x.id !== h.id))}>
									<Trash2 />
								</Button>
							</li>
						))}
					</ul>
				)}
			</CardContent>
			<CardFooter>
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger asChild>
						<Button className="w-full"><Plus /> Add habit</Button>
					</DialogTrigger>
					<DialogContent>
						<form onSubmit={(e) => { e.preventDefault(); add(); }} className="grid gap-4">
							<DialogHeader>
								<DialogTitle>New habit</DialogTitle>
								<DialogDescription>Something small you want to do every day.</DialogDescription>
							</DialogHeader>
							<div className="grid gap-2">
								<Label htmlFor="habit-name">Name</Label>
								<Input id="habit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Drink water" autoFocus />
							</div>
							<DialogFooter>
								<DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
								<Button type="submit" disabled={!name.trim()}>Add</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</CardFooter>
		</Card>
	);
}
