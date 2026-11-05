import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAEMON_SECRET_HEADER, SESSION_COOKIE } from "../../../shared/protocol.ts";
import { apiMiddleware, guardMiddleware } from "../../../viewer/server/api.ts";
import { DaemonContext } from "../../../viewer/server/context.ts";
import { Memory } from "../../../viewer/server/memory.ts";

let server: Server;
let ctx: DaemonContext;
let base: string;
let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "pi-api-"));
	process.env.PI_ARTIFACTS_DIR = dir;
	ctx = new DaemonContext("test", new Memory(":memory:"));
	const guard = guardMiddleware(ctx);
	const api = apiMiddleware(ctx);
	server = createServer((req, res) =>
		guard(req as never, res, () => api(req as never, res, () => res.end("app"))),
	);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	ctx.port = (server.address() as AddressInfo).port;
	base = ctx.origin;
});
afterAll(async () => {
	await new Promise((r) => server.close(r));
	delete process.env.PI_ARTIFACTS_DIR;
	await rm(dir, { recursive: true, force: true });
});

const cookie = () => ({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(ctx.secret)}` });
const secret = () => ({ [DAEMON_SECRET_HEADER]: ctx.secret, "content-type": "application/json" });

describe("guard", () => {
	it("refuses requests without the cookie or secret, with security headers", async () => {
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(401);
		expect(res.headers.get("content-security-policy")).toContain("connect-src 'self'");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("logs in with a link token, sets an HttpOnly SameSite=Strict cookie and redirects locally", async () => {
		const link = new URL(ctx.link("/a/x"));
		const res = await fetch(link, { redirect: "manual" });
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe("/a/x");
		expect(res.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict/);
		expect((await fetch(`${base}/__pi/login?t=bogus`, { redirect: "manual" })).status).toBe(401);
		const evil = new URL(ctx.link("//evil.example"));
		expect((await fetch(evil, { redirect: "manual" })).headers.get("location")).toBe("/");
	});

	it("serves the app with the cookie", async () => {
		const res = await fetch(`${base}/`, { headers: cookie() });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("app");
	});

	it("rejects cross-origin and cross-site state changes even with the cookie", async () => {
		const post = (headers: Record<string, string>) => fetch(`${base}/_serverFn/x`, { method: "POST", headers: { ...cookie(), ...headers } });
		expect((await post({ origin: "http://127.0.0.1:1" })).status).toBe(403);
		expect((await post({ "sec-fetch-site": "same-site" })).status).toBe(403);
		expect((await post({ origin: base })).status).toBe(200);
	});

	it("keeps the extension API out of reach of the browser cookie", async () => {
		expect((await fetch(`${base}/__pi/api/health`, { headers: cookie() })).status).toBe(401);
		const res = await fetch(`${base}/__pi/api/health`, { headers: secret() });
		expect(await res.json()).toMatchObject({ version: "test" });
	});
});

describe("api", () => {
	const post = (path: string, body: unknown) => fetch(`${base}/__pi/api${path}`, { method: "POST", headers: secret(), body: JSON.stringify(body) });

	it("validates memory scopes and ids", async () => {
		expect((await post("/memory", { action: "set", scope: "../x", key: "k", value: 1 })).status).toBe(400);
		expect((await post("/memory", { action: "set", scope: "notes", key: "k", value: 1 })).status).toBe(200);
		expect(await (await post("/memory", { action: "get", scope: "notes", key: "k" })).json()).toBe(1);
		expect((await post("/artifacts/write", { id: "shared", title: "x", code: "" })).status).toBe(400);
		expect((await post("/artifacts/delete", { id: "../../etc" })).status).toBe(400);
	});

	it("registers sessions and refuses MCP calls outside the allowlist", async () => {
		expect((await post("/sessions/register", { sessionId: "s", cwd: "/", bridgeUrl: "http://127.0.0.1:9", bridgeToken: "t" })).status).toBe(200);
		expect(await (await fetch(`${base}/__pi/api/health`, { headers: secret() })).json()).toMatchObject({ sessions: 1 });
		await post("/artifacts/write", { id: "a1", title: "A1", code: "export default () => null", mcp: ["gh.search"] });
		await expect(ctx.mcpCall("a1", "gh.delete_repo", {})).rejects.toThrow(/allowlist/);
		await expect(ctx.mcpCall("nope", "gh.search", {})).rejects.toThrow(/Unknown artifact/);
		await expect(ctx.mcpCall(undefined, "gh.search", {})).rejects.toThrow(/artifact's id/);
	});

	it("deleting an artifact forgets its memory", async () => {
		await post("/artifacts/write", { id: "gone", title: "Gone", code: "" });
		await post("/memory", { action: "set", scope: "gone", key: "k", value: 1 });
		expect(await (await post("/artifacts/delete", { id: "gone" })).json()).toEqual({ deleted: true });
		expect(await (await post("/memory", { action: "list", scope: "gone" })).json()).toEqual([]);
	});
});
