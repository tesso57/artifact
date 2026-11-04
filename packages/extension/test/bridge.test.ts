import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_TOKEN_HEADER } from "@pi-artifacts/core";
import { type Bridge, startBridge, type ToolRunner } from "../src/bridge.ts";

const tools = [
	{ name: "bash", description: "run shell", parameters: {} },
	{ name: "mcp__docs__search", description: "Search docs", parameters: { type: "object" } },
];

function makeRunner(impl?: ToolRunner["executeTool"]): ToolRunner {
	return {
		tools,
		executeTool:
			impl ??
			vi.fn(async () => ({ isError: false, result: { content: [{ type: "text", text: '{"hits":[1,2]}' }] } })),
	};
}

let bridge: Bridge | undefined;
afterEach(async () => {
	await bridge?.close();
	bridge = undefined;
});

async function call(path: string, body?: unknown, token = bridge!.token) {
	const res = await fetch(new URL(path, bridge!.url), {
		method: body === undefined ? "GET" : "POST",
		headers: { [BRIDGE_TOKEN_HEADER]: token, "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: res.status, json: (await res.json()) as any };
}

describe("bridge", () => {
	it("rejects requests without the token", async () => {
		bridge = await startBridge({ getRunner: () => makeRunner(), listAllTools: () => tools });
		expect((await call("/status", undefined, "wrong")).status).toBe(401);
	});

	it("lists only MCP tools", async () => {
		bridge = await startBridge({ getRunner: () => undefined, listAllTools: () => tools });
		const { json } = await call("/mcp/tools");
		expect(json.tools).toEqual([
			{ name: "mcp__docs__search", server: "docs", tool: "search", description: "Search docs", inputSchema: { type: "object" } },
		]);
		expect((await call("/status")).json).toEqual({ ready: false });
	});

	it("calls MCP tools through the runner and parses JSON text", async () => {
		const runner = makeRunner();
		const onCall = vi.fn();
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools, onCall });
		const { status, json } = await call("/mcp/call", { name: "mcp__docs__search", args: { q: "x" }, artifactId: "a1" });
		expect(status).toBe(200);
		expect(json).toMatchObject({ isError: false, text: '{"hits":[1,2]}', data: { hits: [1, 2] } });
		expect(runner.executeTool).toHaveBeenCalledWith("mcp__docs__search", { q: "x" }, expect.anything());
		expect(onCall).toHaveBeenCalledWith("mcp__docs__search", "a1");
	});

	it("unwraps the MCP CallToolResult pi puts in structuredContent", async () => {
		const content = [{ type: "text", text: '{"n":1}' }];
		const withInner = makeRunner(async () => ({
			isError: false,
			result: { content, structuredContent: { content, structuredContent: { n: 3 } } },
		}));
		bridge = await startBridge({ getRunner: () => withInner, listAllTools: () => tools });
		expect((await call("/mcp/call", { name: "mcp__docs__search" })).json.data).toEqual({ n: 3 });
		await bridge.close();

		// No server structuredContent: fall back to JSON text.
		const textOnly = makeRunner(async () => ({ isError: false, result: { content, structuredContent: { content } } }));
		bridge = await startBridge({ getRunner: () => textOnly, listAllTools: () => tools });
		expect((await call("/mcp/call", { name: "mcp__docs__search" })).json.data).toEqual({ n: 1 });
	});

	it("refuses non-MCP tools such as bash", async () => {
		const runner = makeRunner();
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools });
		const { status } = await call("/mcp/call", { name: "bash", args: { command: "rm -rf /" } });
		expect(status).toBe(400);
		expect(runner.executeTool).not.toHaveBeenCalled();
	});

	it("reports 503 before a tool context was captured", async () => {
		bridge = await startBridge({ getRunner: () => undefined, listAllTools: () => tools });
		const { status, json } = await call("/mcp/call", { name: "mcp__docs__search" });
		expect(status).toBe(503);
		expect(json.error).toMatch(/not ready/);
	});

	it("passes tool errors through", async () => {
		const runner = makeRunner(async () => ({ isError: true, result: { content: [{ type: "text", text: "boom" }] } }));
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools });
		expect((await call("/mcp/call", { name: "mcp__docs__search" })).json).toMatchObject({ isError: true, text: "boom" });
	});
});

describe("bridge waiting for MCP servers", () => {
	it("waits for a tool that appears while its server connects", async () => {
		const live: { name: string; description: string; parameters: unknown }[] = [];
		const runner: ToolRunner = {
			get tools() {
				return live;
			},
			executeTool: vi.fn(async () => ({ isError: false, result: { content: [{ type: "text", text: "late" }] } })),
		};
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => live });
		setTimeout(() => live.push({ name: "mcp__slow__ping", description: "", parameters: {} }), 300);
		const { status, json } = await call("/mcp/call", { name: "mcp__slow__ping" });
		expect(status).toBe(200);
		expect(json.text).toBe("late");
	});

	it("gives up with 404 for tools that never appear", async () => {
		bridge = await startBridge({ getRunner: () => makeRunner(), listAllTools: () => tools, connectWaitMs: 300 });
		const { status, json } = await call("/mcp/call", { name: "mcp__nope__x" });
		expect(status).toBe(404);
		expect(json.error).toMatch(/not available/);
	});
});
