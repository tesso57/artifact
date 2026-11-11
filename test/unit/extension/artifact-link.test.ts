import { expect, it, vi } from "vitest";
import { registerArtifactLink } from "../../../extension/tools/artifact-link.ts";

it("issues the requested link when an older daemon returns the full artifact list", async () => {
	let execute!: (callId: string, params: { id: string }, signal: undefined, update: undefined, context: unknown) => Promise<{ content: { text: string }[]; details: { id: string; link: string } }>;
	const pi = { registerTool: (tool: { execute: typeof execute }) => { execute = tool.execute; } };
	const link = "http://127.0.0.1:1234/__pi/login?t=fresh";
	const api = vi.fn(async () => [{ id: "other" }, { id: "target" }]);
	const issueLink = vi.fn(async () => link);
	const runtime = { captureToolContext: vi.fn(), connect: vi.fn(async () => {}), daemon: { api, link: issueLink } };
	registerArtifactLink(pi as never, runtime as never);
	const result = await execute("call", { id: "target" }, undefined, undefined, {});
	expect(api).toHaveBeenCalledWith("/artifacts?id=target");
	expect(issueLink).toHaveBeenCalledWith("/a/target");
	expect(result.details).toEqual({ id: "target", link });
	expect(result.content[0].text).toContain(`Open: ${link}`);
	issueLink.mockClear();
	await expect(execute("call", { id: "missing" }, undefined, undefined, {})).rejects.toThrow(/No artifact/);
	expect(issueLink).not.toHaveBeenCalled();
});

it("rejects an invalid artifact ID before connecting", async () => {
	let execute!: (callId: string, params: { id: string }, signal: undefined, update: undefined, context: unknown) => Promise<unknown>;
	const pi = { registerTool: (tool: { execute: typeof execute }) => { execute = tool.execute; } };
	const connect = vi.fn(async () => {});
	registerArtifactLink(pi as never, { connect } as never);
	await expect(execute("call", { id: "../outside" }, undefined, undefined, {})).rejects.toThrow(/invalid/i);
	expect(connect).not.toHaveBeenCalled();
});
