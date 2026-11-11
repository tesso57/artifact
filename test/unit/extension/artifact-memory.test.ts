import { expect, it, vi } from "vitest";
import { registerArtifactMemory } from "../../../extension/tools/artifact-memory.ts";

function setup(api: (...args: any[]) => Promise<unknown>) {
	let execute!: (id: string, params: { action: string; scope: string; key?: string }, signal: undefined, update: undefined, context: unknown) => Promise<{ content: { text: string }[] }>;
	registerArtifactMemory({ registerTool: (tool: { execute: typeof execute }) => { execute = tool.execute; } } as never, { captureToolContext: () => {}, daemon: { api } } as never);
	return (key: string) => execute("call", { action: "get", scope: "demo", key }, undefined, undefined, {});
}

it("distinguishes stored null from missing memory", async () => {
	const get = setup(async (_path, body) => body.key === "stored" ? { found: true, value: null } : { found: false });
	expect((await get("stored")).content[0].text).toBe("null");
	expect((await get("missing")).content[0].text).toMatch(/no value found/i);
});

it("propagates presence API errors without reading the whole scope", async () => {
	const api = vi.fn(async () => { throw new Error('Unknown memory action "get-with-presence"'); });
	await expect(setup(api)("missing")).rejects.toThrow(/Unknown memory action/);
	expect(api).toHaveBeenCalledOnce();
	expect(api).toHaveBeenCalledWith("/memory", { action: "get-with-presence", scope: "demo", key: "missing" });
});

it("requires an explicit value for set while allowing null", async () => {
	let execute!: (id: string, params: { action: string; scope: string; key: string; value?: unknown }, signal: undefined, update: undefined, context: unknown) => Promise<unknown>;
	const api = vi.fn(async () => ({ ok: true }));
	registerArtifactMemory({ registerTool: (tool: { execute: typeof execute }) => { execute = tool.execute; } } as never, { captureToolContext: () => {}, daemon: { api } } as never);
	await expect(execute("call", { action: "set", scope: "demo", key: "saved" }, undefined, undefined, {})).rejects.toThrow(/value.*required/i);
	await expect(execute("call", { action: "set", scope: "demo", key: "saved", value: () => {} }, undefined, undefined, {})).rejects.toThrow(/JSON/i);
	await expect(execute("call", { action: "set", scope: "demo", key: "saved", value: { toJSON: () => undefined } }, undefined, undefined, {})).rejects.toThrow(/JSON/i);
	expect(api).not.toHaveBeenCalled();
	await execute("call", { action: "set", scope: "demo", key: "saved", value: null }, undefined, undefined, {});
	expect(api).toHaveBeenCalledWith("/memory", { action: "set", scope: "demo", key: "saved", value: null });
	const toJSON = vi.fn().mockReturnValueOnce("safe").mockReturnValueOnce(undefined);
	await execute("call", { action: "set", scope: "demo", key: "saved", value: { toJSON } }, undefined, undefined, {});
	expect(toJSON).toHaveBeenCalledTimes(1);
	expect(api).toHaveBeenLastCalledWith("/memory", { action: "set", scope: "demo", key: "saved", value: "safe" });
});
