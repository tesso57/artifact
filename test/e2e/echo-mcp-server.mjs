#!/usr/bin/env node
// Minimal stdio MCP server for tests.
import { createInterface } from "node:readline";

const tools = [
	{
		name: "reverse",
		description: "Reverse a string",
		inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "stats",
		description: "Return fake repository stats as JSON",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "scalar",
		description: "Return JSON scalar text",
		inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "failure",
		description: "Return an MCP tool error",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "note",
		description: "Store a note (not read-only: artifacts need the user's approval)",
		inputSchema: { type: "object", properties: { text: { type: "string" } } },
	},
];

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
	if (!line.trim()) return;
	const req = JSON.parse(line);
	if (req.id === undefined) return; // notification
	switch (req.method) {
		case "initialize":
			return send({
				id: req.id,
				result: {
					protocolVersion: req.params?.protocolVersion ?? "2025-06-18",
					capabilities: { tools: {} },
					serverInfo: { name: "echo", version: "1.0.0" },
				},
			});
		case "tools/list":
			return send({ id: req.id, result: { tools } });
		case "tools/call": {
			const { name, arguments: args = {} } = req.params;
			if (name === "reverse") {
				return send({ id: req.id, result: { content: [{ type: "text", text: [...String(args.text)].reverse().join("") }] } });
			}
			if (name === "scalar") return send({ id: req.id, result: { content: [{ type: "text", text: String(args.text) }] } });
			if (name === "failure") return send({ id: req.id, result: { isError: true, content: [{ type: "text", text: "deliberate MCP failure" }] } });
			if (name === "note") {
				return send({ id: req.id, result: { content: [{ type: "text", text: `noted: ${args.text}` }] } });
			}
			if (name === "stats") {
				const data = { stars: 1234, issues: [{ day: "Mon", open: 4 }, { day: "Tue", open: 7 }, { day: "Wed", open: 3 }] };
				return send({ id: req.id, result: { content: [{ type: "text", text: JSON.stringify(data) }] } });
			}
			return send({ id: req.id, error: { code: -32602, message: `Unknown tool ${name}` } });
		}
		case "ping":
			return send({ id: req.id, result: {} });
		default:
			return send({ id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } });
	}
});
