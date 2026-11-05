import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_TOKEN_HEADER } from "../../../shared/protocol.ts";
import { type Bridge, startBridge, type ToolListing, type ToolRunner } from "../../../extension/bridge.ts";

const tools: ToolListing[] = [
	{ name: "bash", description: "run shell", parameters: {} },
	{ name: "mcp__docs__search", description: "Search docs", parameters: { type: "object" }, annotations: { readOnlyHint: true, openWorldHint: false } },
	{ name: "mcp__docs__web", description: "Search the web", parameters: {}, annotations: { readOnlyHint: true } },
	{ name: "mcp__docs__delete", description: "Delete a doc", parameters: {} },
];

function makeRunner(impl?: ToolRunner["executeTool"]): ToolRunner {
	return {
		tools,
		executeTool: impl ?? vi.fn(async () => ({ isError: false, result: { content: [{ type: "text", text: '{"hits":[1,2]}' }] } })),
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

const req = (name: string, artifactId = "a1") => ({ name, args: { q: "x" }, artifactId, artifactTitle: "A1" });

describe("bridge", () => {
	it("rejects requests without the token", async () => {
		bridge = await startBridge({ getRunner: () => makeRunner(), listAllTools: () => tools });
		expect((await call("/mcp/tools", undefined, "wrong")).status).toBe(401);
	});

	it("lists only MCP tools, with their read-only hint", async () => {
		bridge = await startBridge({ getRunner: () => undefined, listAllTools: () => tools });
		const { json } = await call("/mcp/tools");
		expect(json.tools.map((t: any) => [t.name, t.readOnly])).toEqual([
			["mcp__docs__search", true],
			["mcp__docs__web", true],
			["mcp__docs__delete", false],
		]);
	});

	it("runs read-only, closed-world tools without asking and parses JSON text", async () => {
		const runner = makeRunner();
		const confirm = vi.fn(async () => false);
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools, confirm });
		const { status, json } = await call("/mcp/call", req("mcp__docs__search"));
		expect(status).toBe(200);
		expect(json).toEqual({ isError: false, text: '{"hits":[1,2]}', data: { hits: [1, 2] } });
		expect(confirm).not.toHaveBeenCalled();
	});

	it("asks once per tool per session for tools that may change things or reach out (artifact ids are not trusted)", async () => {
		const runner = makeRunner();
		const confirm = vi.fn(async () => true);
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools, confirm });
		expect((await call("/mcp/call", req("mcp__docs__delete"))).status).toBe(200);
		expect((await call("/mcp/call", req("mcp__docs__delete", "another-artifact"))).status).toBe(200);
		expect(confirm).toHaveBeenCalledTimes(1);
		expect((await call("/mcp/call", req("mcp__docs__web"))).status).toBe(200); // read-only but open-world
		expect(confirm).toHaveBeenCalledTimes(2);
	});

	it("declines tools needing approval when nobody can approve", async () => {
		bridge = await startBridge({ getRunner: () => makeRunner(), listAllTools: () => tools });
		expect((await call("/mcp/call", req("mcp__docs__delete"))).status).toBe(403);
	});

	it("refuses when the user declines", async () => {
		const runner = makeRunner();
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools, confirm: async () => false });
		expect((await call("/mcp/call", req("mcp__docs__delete"))).status).toBe(403);
		expect(runner.executeTool).not.toHaveBeenCalled();
	});

	it("unwraps the MCP CallToolResult pi puts in structuredContent", async () => {
		const content = [{ type: "text", text: '{"n":1}' }];
		const withInner = makeRunner(async () => ({ isError: false, result: { content, structuredContent: { content, structuredContent: { n: 3 } } } }));
		bridge = await startBridge({ getRunner: () => withInner, listAllTools: () => tools });
		expect((await call("/mcp/call", req("mcp__docs__search"))).json.data).toEqual({ n: 3 });
	});

	it("refuses non-MCP tools such as bash", async () => {
		const runner = makeRunner();
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools });
		expect((await call("/mcp/call", { name: "bash", args: { command: "rm -rf /" } })).status).toBe(400);
		expect(runner.executeTool).not.toHaveBeenCalled();
	});

	it("reports 503 before a tool context was captured", async () => {
		bridge = await startBridge({ getRunner: () => undefined, listAllTools: () => tools });
		expect((await call("/mcp/call", req("mcp__docs__search"))).status).toBe(503);
	});

	it("waits for a tool whose server is still connecting, and gives up with 404", async () => {
		const live: ToolListing[] = [];
		const runner: ToolRunner = {
			get tools() {
				return live;
			},
			executeTool: vi.fn(async () => ({ isError: false, result: { content: [{ type: "text", text: "late" }] } })),
		};
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => live, connectWaitMs: 1500 });
		setTimeout(() => live.push({ name: "mcp__slow__ping", description: "", parameters: {}, annotations: { readOnlyHint: true, openWorldHint: false } }), 300);
		expect((await call("/mcp/call", req("mcp__slow__ping"))).json.text).toBe("late");
		expect((await call("/mcp/call", req("mcp__nope__x"))).status).toBe(404);
	});
});
