import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type Responses = { confirm?: boolean[]; select?: (string | undefined)[] };

/** Command-focused Pi double, adapted from pi-extension-template. */
export function createMockPi(responses: Responses = {}) {
	const commands = new Map<string, Command>();
	const dialogs: ({ kind: "select"; title: string; options: string[] } | { kind: "confirm"; title: string; message: string })[] = [];
	const notifications: { message: string; type: string }[] = [];
	const queues = { confirm: [...(responses.confirm ?? [])], select: [...(responses.select ?? [])] };
	function take<K extends keyof typeof queues>(kind: K): (typeof queues)[K][number] {
		const queue = queues[kind];
		if (queue.length === 0) throw new Error(`No mock response for ${kind}`);
		return queue.shift() as (typeof queues)[K][number];
	}
	const context = {
		cwd: process.cwd(),
		hasUI: true,
		ui: {
			notify(message: string, type = "info") { notifications.push({ message, type }); },
			async confirm(title: string, message: string) { dialogs.push({ kind: "confirm", title, message }); return take("confirm"); },
			async select(title: string, options: string[]) { dialogs.push({ kind: "select", title, options: [...options] }); return take("select"); },
		},
	} as unknown as ExtensionCommandContext;
	const pi = {
		registerCommand(name: string, command: Command) { commands.set(name, command); },
	} as unknown as ExtensionAPI;
	return {
		pi, context, dialogs, notifications,
		async runCommand(name: string, args = "") {
			const command = commands.get(name);
			if (!command) throw new Error(`Unknown command: ${name}`);
			await command.handler(args, context);
		},
	};
}
