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
	it("returns a timeout even if the tool ignores its abort signal", async () => {
		let release!: () => void;
		let started!: () => void;
		let signal: AbortSignal | undefined;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const startedPromise = new Promise<void>((resolve) => { started = resolve; });
		const runner = makeRunner(async (_name, _args, options) => {
			signal = options?.signal;
			started();
			await gate;
			return { isError: false, result: { content: [] } };
		});
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools, timeoutMs: 50 });
		const request = call("/mcp/call", req("mcp__docs__search"));
		await startedPromise;
		const result = await Promise.race([request, new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 1000))]);
		const cancelled = signal?.aborted;
		release();
		await request;
		expect(result).toMatchObject({ status: 504, json: { error: expect.stringMatching(/timed out/i) } });
		expect(cancelled).toBe(true);
	});
	it("closes promptly and signals cancellation when a tool ignores cancellation", async () => {
		let release!: () => void;
		let started!: () => void;
		let signal: AbortSignal | undefined;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const startedPromise = new Promise<void>((resolve) => { started = resolve; });
		const runner = makeRunner(async (_name, _args, options) => {
			signal = options?.signal;
			started();
			await gate;
			return { isError: false, result: { content: [] } };
		});
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools });
		const request = call("/mcp/call", req("mcp__docs__search")).catch(() => undefined);
		await startedPromise;
		const closing = bridge.close();
		const result = await Promise.race([closing.then(() => "closed"), new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 200))]);
		const cancelled = signal?.aborted;
		release();
		await Promise.allSettled([request, closing]);
		expect(result).toBe("closed");
		expect(cancelled).toBe(true);
	});

	it("does not run a tool if approval arrives after the bridge closes", async () => {
		let approve!: (value: boolean) => void;
		let asked!: () => void;
		const approval = new Promise<boolean>((resolve) => { approve = resolve; });
		const requested = new Promise<void>((resolve) => { asked = resolve; });
		const runner = makeRunner();
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools, confirm: () => { asked(); return approval; } });
		const request = call("/mcp/call", req("mcp__docs__delete")).catch(() => undefined);
		await requested;
		await bridge.close();
		approve(true);
		await request;
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(runner.executeTool).not.toHaveBeenCalled();
	});
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

	it.each([["42", 42], ["9007199254740991", 9007199254740991], ["false", false], ["null", null], ['"hello"', "hello"]])("parses scalar JSON text %s", async (text, data) => {
		const runner = makeRunner(async () => ({ isError: false, result: { content: [{ type: "text", text }] } }));
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools });
		expect((await call("/mcp/call", req("mcp__docs__search"))).json).toEqual({ isError: false, text, data });
	});

	it.each(["1e400", "-1e400", '{"value":1e400}'])("preserves unrepresentable JSON numbers as text: %s", async (text) => {
		const runner = makeRunner(async () => ({ isError: false, result: { content: [{ type: "text", text }] } }));
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools });
		expect((await call("/mcp/call", req("mcp__docs__search"))).json).toEqual({ isError: false, text });
	});

	it.each(["9007199254740993", "-9007199254740993", '{"id":9007199254740993}'])("does not silently round unsafe JSON integers: %s", async (text) => {
		const runner = makeRunner(async () => ({ isError: false, result: { content: [{ type: "text", text }] } }));
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools });
		expect((await call("/mcp/call", req("mcp__docs__search"))).json).toEqual({ isError: false, text });
	});

	it.each(["1e-400", "-1e-400", '{"value":1e-400}'])("does not silently turn tiny nonzero JSON numbers into zero: %s", async (text) => {
		const runner = makeRunner(async () => ({ isError: false, result: { content: [{ type: "text", text }] } }));
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools });
		expect((await call("/mcp/call", req("mcp__docs__search"))).json).toEqual({ isError: false, text });
	});

	it("still parses an actual zero with an exponent", async () => {
		const runner = makeRunner(async () => ({ isError: false, result: { content: [{ type: "text", text: "0e-400" }] } }));
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools });
		expect((await call("/mcp/call", req("mcp__docs__search"))).json.data).toBe(0);
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

	it("shares one approval prompt across concurrent calls to the same tool", async () => {
		let approve!: (value: boolean) => void;
		let bothArrived!: () => void;
		const gate = new Promise<boolean>((resolve) => { approve = resolve; });
		const arrived = new Promise<void>((resolve) => { bothArrived = resolve; });
		const confirm = vi.fn(() => gate);
		const runner = makeRunner();
		let requests = 0;
		bridge = await startBridge({
			getRunner: () => { if (++requests === 2) bothArrived(); return runner; },
			listAllTools: () => tools,
			confirm,
		});
		const first = call("/mcp/call", req("mcp__docs__delete", "a"));
		const second = call("/mcp/call", req("mcp__docs__delete", "b"));
		try {
			await arrived;
			expect(confirm).toHaveBeenCalledTimes(1);
		} finally { approve(true); }
		expect((await Promise.all([first, second])).map((r) => r.status)).toEqual([200, 200]);
		expect(runner.executeTool).toHaveBeenCalledTimes(2);
	});

	it("can ask again after an approval is declined", async () => {
		const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		bridge = await startBridge({ getRunner: () => makeRunner(), listAllTools: () => tools, confirm });
		expect((await call("/mcp/call", req("mcp__docs__delete"))).status).toBe(403);
		expect((await call("/mcp/call", req("mcp__docs__delete"))).status).toBe(200);
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

	it("does not turn non-finite structured data into null", async () => {
		const content = [{ type: "text", text: '{"value":1e400}' }];
		const runner = makeRunner(async () => ({ isError: false, result: { content, structuredContent: { content, structuredContent: { value: Infinity } } } }));
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools });
		expect((await call("/mcp/call", req("mcp__docs__search"))).json).toEqual({ isError: false, text: '{"value":1e400}' });
	});

	it("does not expose unsafe structured integers as exact data", async () => {
		const content = [{ type: "text", text: '{"id":9007199254740993}' }];
		const runner = makeRunner(async () => ({ isError: false, result: { content, structuredContent: { content, structuredContent: { id: 9007199254740992 } } } }));
		bridge = await startBridge({ getRunner: () => runner, listAllTools: () => tools });
		expect((await call("/mcp/call", req("mcp__docs__search"))).json).toEqual({ isError: false, text: '{"id":9007199254740993}' });
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

	it("ends the connection wait even if the wall clock stops", async () => {
		const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
		const restore = setTimeout(() => clock.mockRestore(), 4000);
		try {
			bridge = await startBridge({ getRunner: () => makeRunner(), listAllTools: () => tools, connectWaitMs: 50 });
			const start = performance.now();
			expect((await call("/mcp/call", req("mcp__missing__tool"))).status).toBe(404);
			expect(performance.now() - start).toBeLessThan(3000);
		} finally {
			clearTimeout(restore);
			clock.mockRestore();
		}
	});
});
