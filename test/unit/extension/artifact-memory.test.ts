import { expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../../../extension/daemon-client.ts";
import { PROTOCOL_VERSION } from "../../../shared/protocol.ts";
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

it("uses the legacy list API when the daemon lacks presence support", async () => {
	const api = vi.fn(async (_path, body) => {
		if (body.action === "get-with-presence") throw new Error('Unknown memory action "get-with-presence"');
		return [{ key: "stored", value: null }];
	});
	const get = setup(api);
	expect((await get("stored")).content[0].text).toBe("null");
	expect((await get("missing")).content[0].text).toMatch(/no value found/i);
});

it("falls back through the HTTP client against a legacy memory API", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-legacy-memory-"));
	const version = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version;
	const actions: string[] = [];
	const server = createServer(async (req, res) => {
		res.setHeader("content-type", "application/json");
		if (req.url === "/__pi/api/health") return res.end(JSON.stringify({ protocol: PROTOCOL_VERSION, version }));
		let body = "";
		for await (const chunk of req) body += chunk;
		const { action } = JSON.parse(body);
		actions.push(action);
		if (action === "get-with-presence") { res.statusCode = 400; return res.end(JSON.stringify({ error: `Unknown memory action ${JSON.stringify(action)}` })); }
		return res.end(JSON.stringify([{ key: "stored", value: null }]));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	const previous = process.env.PI_ARTIFACTS_STATE;
	process.env.PI_ARTIFACTS_STATE = dir;
	writeFileSync(join(dir, "viewer.json"), JSON.stringify({ protocol: PROTOCOL_VERSION, pid: 1, port, url: `http://127.0.0.1:${port}`, secret: "secret", version, startedAt: 0 }));
	try {
		const client = new DaemonClient();
		const get = setup((path, body) => client.api(path, body));
		expect((await get("stored")).content[0].text).toBe("null");
		expect((await get("missing")).content[0].text).toMatch(/no value found/i);
		expect(actions).toEqual(["get-with-presence", "list", "get-with-presence", "list"]);
	} finally {
		if (previous === undefined) delete process.env.PI_ARTIFACTS_STATE; else process.env.PI_ARTIFACTS_STATE = previous;
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(dir, { recursive: true, force: true });
	}
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
