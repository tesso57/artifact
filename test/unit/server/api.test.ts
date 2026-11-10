import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DAEMON_SECRET_HEADER } from "../../../shared/protocol.ts";
import { fsUrl } from "../../../shared/paths.ts";
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

let session = "";
const cookie = () => ({ cookie: `${ctx.cookieName}=${session}` });
async function login(next = "/") {
	const res = await fetch(new URL(ctx.link(next)), { redirect: "manual" });
	return { res, value: /pi_artifacts_\d+=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "" };
}
const secret = () => ({ [DAEMON_SECRET_HEADER]: ctx.secret, "content-type": "application/json" });

describe("guard", () => {
	it("preserves orphaned memory when deleting a missing artifact", async () => {
		ctx.memory.set("missing-artifact", "saved", "keep");
		const response = await fetch(`${base}/__pi/api/artifacts/delete`, {
			method: "POST", headers: secret(), body: JSON.stringify({ id: "missing-artifact" }),
		});
		expect(response.ok).toBe(true);
		expect(await response.json()).toEqual({ deleted: false });
		expect(ctx.memory.get("missing-artifact", "saved")).toBe("keep");
	});
	it("notifies open pages when deletion clears artifact memory", async () => {
		const { writeArtifact } = await import("../../../viewer/server/store.ts");
		await writeArtifact({ id: "delete-notification", title: "Test", code: "" });
		ctx.memory.set("delete-notification", "saved", "value");
		const notify = vi.spyOn(ctx, "memoryChanged");
		try {
			expect(await ctx.deleteArtifact("delete-notification")).toBe(true);
			expect(ctx.memory.get("delete-notification", "saved")).toBeUndefined();
			expect(notify).toHaveBeenCalledWith("delete-notification");
		} finally { notify.mockRestore(); }
	});
	it("keeps an unused link available until its advertised expiry even after idle timeout", () => {
		const clock = vi.spyOn(performance, "now").mockReturnValue(0);
		const memory = new Memory(":memory:");
		try {
			const isolated = new DaemonContext("test", memory);
			const token = new URL(isolated.link("/a/x")).searchParams.get("t");
			clock.mockReturnValue(16 * 60_000);
			expect(isolated.isIdle(15 * 60_000)).toBe(false);
			expect(isolated.login(token)?.next).toBe("/a/x");
			expect(isolated.isIdle(15 * 60_000)).toBe(true);
			isolated.link("/a/y");
			clock.mockReturnValue(47 * 60_000);
			expect(isolated.isIdle(15 * 60_000)).toBe(true);
		} finally {
			clock.mockRestore();
			memory.close();
		}
	});
	it("uses elapsed time for links, sessions, and idle activity", () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1000);
		try {
			const token = new URL(ctx.link("/a/x")).searchParams.get("t");
			now.mockReturnValue(1000 + 40 * 60_000);
			const login = ctx.login(token);
			expect(login?.next).toBe("/a/x");
			now.mockReturnValue(1000 + 9 * 24 * 60 * 60_000);
			expect(ctx.browserSession(login?.session)).toBe(true);
			ctx.touch();
			expect(Math.abs(ctx.lastActivity - performance.now())).toBeLessThan(1000);
		} finally {
			now.mockRestore();
		}
	});
	it("keeps an open tab observed when the wall clock changes", () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1000);
		try {
			ctx.noteViewing("clock-test");
			now.mockReturnValue(121_000);
			expect(ctx.isViewing("clock-test")).toBe(true);
			expect(ctx.isViewing("never-opened")).toBe(false);
		} finally {
			now.mockRestore();
		}
	});

	it("treats a malformed session cookie as unauthenticated", () => {
		const req = { url: "/", headers: { cookie: `${ctx.cookieName}=%` } };
		const res = { statusCode: 0, setHeader() {}, end() {} };
		expect(() => guardMiddleware(ctx)(req as never, res as never, () => {})).not.toThrow();
		expect(res.statusCode).toBe(401);
	});

	it("refuses requests without the cookie or secret, with security headers", async () => {
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(401);
		expect(res.headers.get("content-security-policy")).toContain("connect-src 'self'");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("logs in with a one-time link token and sets a session cookie that is not the API secret", async () => {
		const link = new URL(ctx.link("/a/x"));
		const res = await fetch(link, { redirect: "manual" });
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe("/a/x");
		expect(res.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict/);
		session = /pi_artifacts_\d+=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1];
		expect(session).not.toBe(ctx.secret);
		expect(session).not.toContain(encodeURIComponent(ctx.secret));
		// Single use: the same link does not log a new browser in...
		expect((await fetch(link, { redirect: "manual" })).status).toBe(401);
		// ...but a browser that is already signed in is simply sent on (clicking it again).
		const again = await fetch(link, { redirect: "manual", headers: cookie() });
		expect(again.status).toBe(302);
		expect(again.headers.get("location")).toBe("/a/x");
		// A fresh link opened by a signed-in browser is used up too: it cannot sign others in.
		const fresh = new URL(ctx.link("/a/y"));
		expect((await fetch(fresh, { redirect: "manual", headers: cookie() })).headers.get("location")).toBe("/a/y");
		expect((await fetch(fresh, { redirect: "manual" })).status).toBe(401);
		expect((await fetch(`${base}/__pi/login?t=bogus`, { redirect: "manual" })).status).toBe(401);
		// The master secret is not a login token.
		expect((await fetch(`${base}/__pi/login?t=${ctx.secret}`, { redirect: "manual" })).status).toBe(401);
	});

	it("only redirects to local paths", async () => {
		for (const next of ["//evil.example", "/\\evil.example", "https://evil.example", "/\t/evil.example", "/ /x"]) {
			expect((await login(next)).res.headers.get("location")).toBe("/");
		}
	});

	it("does not accept the API secret as a cookie, or a cookie as the API secret", async () => {
		expect((await fetch(`${base}/`, { headers: { cookie: `${ctx.cookieName}=${ctx.secret}` } })).status).toBe(401);
		expect((await fetch(`${base}/__pi/api/health`, { headers: { [DAEMON_SECRET_HEADER]: session } })).status).toBe(401);
	});

	it("blocks Vite's open-in-editor endpoint", async () => {
		expect((await fetch(`${base}/__open-in-editor?file=/etc/passwd`, { headers: cookie() })).status).toBe(403);
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

	it("records authenticated API activity for idle shutdown", async () => {
		ctx.lastActivity = 0;
		expect((await fetch(`${base}/__pi/api/health`, { headers: secret() })).status).toBe(200);
		expect(ctx.lastActivity).toBeGreaterThan(0);
	});
});

describe("api", () => {
	const post = (path: string, body: unknown) => fetch(`${base}/__pi/api${path}`, { method: "POST", headers: secret(), body: JSON.stringify(body) });

	it("finishes checking one write before replacing the same artifact", async () => {
		let release!: () => void;
		let checking!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const started = new Promise<void>((resolve) => { checking = resolve; });
		let calls = 0;
		const compile = vi.spyOn(ctx, "compileCheck").mockImplementation(async () => {
			if (++calls === 1) { checking(); await gate; }
			return undefined;
		});
		const first = ctx.writeArtifact({ id: "serial-check", title: "First", code: "one" }, 0);
		let second: Promise<unknown> | undefined;
		try {
			await started;
			second = ctx.writeArtifact({ id: "serial-check", title: "Second", code: "two" }, 0);
			await new Promise((resolve) => setTimeout(resolve, 100));
			const { readFile } = await import("node:fs/promises");
			expect(await readFile(join(dir, "serial-check", "index.tsx"), "utf8")).toBe("one");
		} finally {
			release();
			await Promise.allSettled([first, ...(second ? [second] : [])]);
			compile.mockRestore();
			await ctx.deleteArtifact("serial-check");
		}
	});

	it("finishes checking one template before replacing it", async () => {
		let release!: () => void;
		let checking!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const started = new Promise<void>((resolve) => { checking = resolve; });
		let calls = 0;
		const compile = vi.spyOn(ctx, "compileCheck").mockImplementation(async () => {
			if (++calls === 1) { checking(); await gate; }
			return undefined;
		});
		const template = { name: "serial-template", title: "Template", description: "Test", useCases: ["test"] };
		const first = post("/templates/save", { ...template, code: "one" });
		let second: Promise<Response> | undefined;
		try {
			await started;
			second = post("/templates/save", { ...template, code: "two" });
			await new Promise((resolve) => setTimeout(resolve, 100));
			const { readFile } = await import("node:fs/promises");
			expect(await readFile(join(dir, ".templates", "serial-template", "template.tsx"), "utf8")).toBe("one");
		} finally {
			release();
			await Promise.allSettled([first, ...(second ? [second] : [])]);
			compile.mockRestore();
			await post("/templates/delete", { name: "serial-template" });
		}
	});

	it("reports errors by arrival order even when the wall clock moves backward", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1000);
		ctx.noteViewing("clock-errors");
		ctx.reportError("clock-errors", "old");
		const compile = vi.spyOn(ctx, "compileCheck").mockImplementation(async () => {
			now.mockReturnValue(500);
			ctx.reportError("clock-errors", "new");
			return undefined;
		});
		try {
			const result = await ctx.writeArtifact({ id: "clock-errors", title: "Clock", code: "" }, 0);
			expect(result.runtimeErrors.map((error) => error.message)).toEqual(["new"]);
		} finally {
			compile.mockRestore();
			now.mockRestore();
			await ctx.deleteArtifact("clock-errors");
		}
	});

	it("responds with 413 when the request body exceeds the limit", async () => {
		const response = await post("/memory", { action: "set", scope: "notes", key: "large", value: "x".repeat(4 * 1024 * 1024) });
		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({ error: "Request body too large" });
	});

	it("validates memory scopes and ids", async () => {
		expect((await post("/memory", { action: "set", scope: "../x", key: "k", value: 1 })).status).toBe(400);
		expect((await post("/memory", { action: "set", scope: "notes", key: "k", value: 1 })).status).toBe(200);
		expect(await (await post("/memory", { action: "get", scope: "notes", key: "k" })).json()).toBe(1);
		expect((await post("/artifacts/write", { id: "shared", title: "x", code: "" })).status).toBe(400);
		expect((await post("/artifacts/delete", { id: "../../etc" })).status).toBe(400);
	});

	it("reports the saved artifact id if a post-save check fails", async () => {
		const compile = vi.spyOn(ctx, "compileCheck").mockRejectedValueOnce(new Error("check unavailable"));
		try {
			const response = await post("/artifacts/write", { title: "Post-save check", code: "export default () => null" });
			expect(response.status).toBe(400);
			expect((await response.json()).error).toMatch(/artifact "post-save-check" was saved.*check unavailable/i);
			expect(await (await fetch(`${base}/__pi/api/artifacts?id=post-save-check`, { headers: secret() })).json()).toMatchObject([{ id: "post-save-check" }]);
		} finally { compile.mockRestore(); await ctx.deleteArtifact("post-save-check"); }
	});

	it("reports deleted files and retains memory when delete cleanup fails", async () => {
		const { writeArtifact, readMeta } = await import("../../../viewer/server/store.ts");
		await writeArtifact({ id: "failed-cleanup", title: "Cleanup", code: "source" });
		ctx.memory.set("failed-cleanup", "saved", "keep");
		const forget = vi.spyOn(ctx.memory, "forget").mockImplementationOnce(() => { throw new Error("database unavailable"); });
		try {
			const response = await post("/artifacts/delete", { id: "failed-cleanup" });
			expect(response.status).toBe(400);
			expect((await response.json()).error).toMatch(/artifact "failed-cleanup" files were deleted.*cleanup failed.*database unavailable/i);
			expect(await readMeta("failed-cleanup")).toBeUndefined();
			expect(ctx.memory.get("failed-cleanup", "saved")).toBe("keep");
		} finally { forget.mockRestore(); ctx.memory.forget("failed-cleanup"); }
	});

	it("distinguishes stored null from a missing key without changing legacy get", async () => {
		await post("/memory", { action: "set", scope: "presence", key: "null-value", value: null });
		expect(await (await post("/memory", { action: "get", scope: "presence", key: "null-value" })).json()).toBeNull();
		expect(await (await post("/memory", { action: "get-with-presence", scope: "presence", key: "null-value" })).json()).toEqual({ found: true, value: null });
		expect(await (await post("/memory", { action: "get-with-presence", scope: "presence", key: "missing" })).json()).toEqual({ found: false });
	});

	it("can retrieve one artifact without returning unrelated entries", async () => {
		await ctx.writeArtifact({ id: "lookup-one", title: "One", code: "" }, 0);
		await ctx.writeArtifact({ id: "lookup-two", title: "Two", code: "" }, 0);
		const get = (query: string) => fetch(`${base}/__pi/api/artifacts${query}`, { headers: secret() });
		const selected = await (await get("?id=lookup-one")).json() as { id: string }[];
		expect(selected.map((item) => item.id)).toEqual(["lookup-one"]);
		expect(await (await get("?id=missing-artifact")).json()).toEqual([]);
		expect((await get("?id=..%2Fbad")).status).toBe(400);
		await rm(join(dir, "lookup-one", "index.tsx"));
		const missingSource = await get("?id=lookup-one");
		expect(missingSource.status).toBe(400);
		expect(await missingSource.json()).toEqual({ error: expect.stringMatching(/source.*missing|missing.*source/i) });
		expect(await ctx.listArtifacts()).toEqual(expect.arrayContaining([expect.objectContaining({ id: "lookup-one" })]));
		const { symlink, writeFile } = await import("node:fs/promises");
		const outside = join(dir, "outside-source.tsx");
		await writeFile(outside, "outside");
		await rm(join(dir, "lookup-two", "index.tsx"));
		try { await symlink(outside, join(dir, "lookup-two", "index.tsx")); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		const linkedSource = await get("?id=lookup-two");
		expect(linkedSource.status).toBe(400);
		expect(await linkedSource.json()).toEqual({ error: expect.stringMatching(/source.*regular/i) });
	});

	it("rejects malformed artifact metadata without changing an existing artifact", async () => {
		await ctx.writeArtifact({ id: "invalid-input", title: "Original", code: "original", mcp: ["gh.*"] }, 0);
		for (const invalid of [{ mcp: "" }, { mcp: [42] }, { description: {} }, { cwd: [] }, { sessionId: 1 }]) {
			const response = await post("/artifacts/write", { id: "invalid-input", title: "Changed", code: "changed", ...invalid });
			expect(response.status).toBe(400);
			const meta = await ctx.artifactView("invalid-input");
			expect(meta.title).toBe("Original");
			expect(meta.mcp).toEqual(["gh.*"]);
			expect(await ctx.moduleSource(meta.moduleUrl)).toBe("original");
		}
	});

	it("reads source from paths containing URL-reserved characters", async () => {
		const { mkdir, writeFile } = await import("node:fs/promises");
		const root = join(dir, "folder # 日本");
		const file = join(root, "sample", "index.tsx");
		await mkdir(join(root, "sample"), { recursive: true });
		await writeFile(file, "export default () => null");
		const previous = process.env.PI_ARTIFACTS_DIR;
		try {
			process.env.PI_ARTIFACTS_DIR = root;
			expect(await ctx.moduleSource(fsUrl(file))).toBe("export default () => null");
		} finally {
			process.env.PI_ARTIFACTS_DIR = previous;
		}
	});

	it("uses a restricted virtual module for artifact paths containing URL delimiters", async () => {
		const previous = process.env.PI_ARTIFACTS_DIR;
		try {
			process.env.PI_ARTIFACTS_DIR = join(dir, "path # ? %");
			await ctx.writeArtifact({ id: "virtual-test", title: "Virtual", code: "export default () => null" }, 0);
			const view = await ctx.artifactView("virtual-test");
			expect(view.moduleUrl).toBe("/__pi_virtual__/a/virtual-test/index.tsx");
			expect(await ctx.moduleSource(view.moduleUrl)).toBe("export default () => null");
			await expect(ctx.moduleSource("/__pi_virtual__/a/../index.tsx")).rejects.toThrow();
		} finally {
			process.env.PI_ARTIFACTS_DIR = previous;
		}
	});

	it("refuses nested and daemon-state files that merely share an entry filename", async () => {
		const { mkdir, writeFile } = await import("node:fs/promises");
		for (const parts of [[".state", "index.tsx"], ["some-artifact", "private", "index.tsx"], [".templates", "some-template", "private", "template.tsx"]]) {
			const file = join(dir, ...parts);
			await mkdir(join(file, ".."), { recursive: true });
			await writeFile(file, "private");
			await expect(ctx.moduleSource(fsUrl(file))).rejects.toThrow(/Not an artifact module/);
		}
	});

	it("refuses a virtual module whose entry points outside allowed roots", async () => {
		const { mkdir, rm, symlink, writeFile } = await import("node:fs/promises");
		const previous = process.env.PI_ARTIFACTS_DIR;
		const root = join(dir, "restricted # root");
		const outside = join(dir, "outside", "index.tsx");
		try {
			process.env.PI_ARTIFACTS_DIR = root;
			await ctx.writeArtifact({ id: "linked", title: "Linked", code: "safe" }, 0);
			await mkdir(join(dir, "outside"), { recursive: true });
			await writeFile(outside, 'export default function Private() { return <p>PRIVATE</p>; }');
			const entry = join(root, "linked", "index.tsx");
			await rm(entry);
			try {
				await symlink(outside, entry, "file");
			} catch (error) {
				if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
				throw error;
			}
			await expect(ctx.moduleSource("/__pi_virtual__/a/linked/index.tsx")).rejects.toThrow(/Not an artifact module/);
			let exportError: unknown;
			try { await ctx.exportArtifact("linked"); } catch (error) { exportError = error; }
			expect(exportError).toBeInstanceOf(Error);
			expect((exportError as Error).message).toMatch(/Not an artifact module/);
		} finally {
			process.env.PI_ARTIFACTS_DIR = previous;
		}
	});

	it("limits new memory keys while allowing legacy long keys to be read and removed", async () => {
		const allowed = "a".repeat(512);
		const legacy = "b".repeat(513);
		expect((await post("/memory", { action: "set", scope: "notes", key: allowed, value: 1 })).status).toBe(200);
		expect((await post("/memory", { action: "set", scope: "notes", key: legacy, value: 2 })).status).toBe(400);
		ctx.memory.set("notes", legacy, "old");
		expect(await (await post("/memory", { action: "get", scope: "notes", key: legacy })).json()).toBe("old");
		expect(await (await post("/memory", { action: "delete", scope: "notes", key: legacy })).json()).toEqual({ deleted: true });
	});

	it("rejects new keys with unpaired surrogates before they collide in SQLite", async () => {
		for (const key of ["x\ud800", "x\udc00"]) {
			expect((await post("/memory", { action: "set", scope: "unicode", key, value: 1 })).status).toBe(400);
		}
		expect((await post("/memory", { action: "set", scope: "unicode", key: "x😀", value: 2 })).status).toBe(200);
	});

	it("refuses exports outside .html files and silent overwrites", async () => {
		await post("/artifacts/write", { id: "ex", title: "Ex", code: "" });
		const sh = join(dir, "x.sh");
		expect(await (await post("/export", { id: "ex", outFile: sh })).json()).toMatchObject({ error: expect.stringMatching(/\.html/) });
		const { writeFile } = await import("node:fs/promises");
		const existing = join(dir, "exists.html");
		await writeFile(existing, "keep");
		expect(await (await post("/export", { id: "ex", outFile: existing })).json()).toMatchObject({ error: expect.stringMatching(/exists/) });
		const { readFile } = await import("node:fs/promises");
		expect(await readFile(existing, "utf8")).toBe("keep");
	});

	it("reserves template- ids so artifacts cannot borrow a template's allowlist", async () => {
		expect((await post("/artifacts/write", { id: "template-mcp-explorer", title: "x", code: "" })).status).toBe(400);
		const r = await (await post("/artifacts/write", { title: "Template MCP Explorer", code: "" })).json();
		expect(r.meta.id).toBe("artifact-template-mcp-explorer");
	});

	it("registers sessions and refuses MCP calls outside the allowlist", async () => {
		expect((await post("/sessions/register", { sessionId: "s", cwd: "/", bridgeUrl: "http://127.0.0.1:9", bridgeToken: "t" })).status).toBe(200);
		expect(await (await fetch(`${base}/__pi/api/health`, { headers: secret() })).json()).toMatchObject({ sessions: 1 });
		await post("/artifacts/write", { id: "a1", title: "A1", code: "export default () => null", mcp: ["gh.search"] });
		await expect(ctx.mcpCall("a1", "gh.delete_repo", {})).rejects.toThrow(/allowlist/);
		await expect(ctx.mcpCall("nope", "gh.search", {})).rejects.toThrow(/Unknown artifact/);
		await expect(ctx.mcpCall(undefined, "gh.search", {})).rejects.toThrow(/artifact's id/);
	});

	it("supports memory and MCP for a maximum-length template preview name", async () => {
		const previous = process.env.PI_ARTIFACTS_TEMPLATES;
		process.env.PI_ARTIFACTS_TEMPLATES = join(dir, "long-templates");
		const name = "t".repeat(64);
		const bridge = createServer((_req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ isError: false, text: "ok" }));
		});
		await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
		try {
			const { saveTemplate } = await import("../../../viewer/server/templates.ts");
			await saveTemplate(name, { title: "Long", description: "Long name", useCases: ["test"], mcp: ["echo.read"] }, "export default () => null");
			const preview = await ctx.templateView(name);
			expect(ctx.scope(preview.id)).toBe(preview.id);
			expect(() => ctx.scope(`template-${"t".repeat(65)}`)).toThrow(/scope/i);
			ctx.noteViewing(preview.id);
			expect(ctx.isViewing(preview.id)).toBe(true);
			const port = (bridge.address() as AddressInfo).port;
			ctx.sessions.upsert({ sessionId: "long-template", cwd: "/", bridgeUrl: `http://127.0.0.1:${port}`, bridgeToken: "t", tools: ["mcp__echo__read"] });
			expect((await ctx.mcpCall(preview.id, "echo.read", {})).text).toBe("ok");
		} finally {
			ctx.sessions.remove("long-template");
			if (previous === undefined) delete process.env.PI_ARTIFACTS_TEMPLATES;
			else process.env.PI_ARTIFACTS_TEMPLATES = previous;
			await new Promise<void>((resolve) => bridge.close(() => resolve()));
		}
	});

	it("forgets preview data only when a user template is deleted", async () => {
		const previous = process.env.PI_ARTIFACTS_TEMPLATES;
		process.env.PI_ARTIFACTS_TEMPLATES = join(dir, "delete-templates");
		try {
			const { saveTemplate } = await import("../../../viewer/server/templates.ts");
			await saveTemplate("delete-me", { title: "Delete", description: "Test", useCases: ["test"] }, "export default () => null");
			const scope = "template-delete-me";
			ctx.memory.set(scope, "draft", "private");
			ctx.memory.set("shared", "template-shared", "shared value");
			ctx.memory.noteSharedRead(scope, "template-shared");
			ctx.memory.cacheMcp(scope, "mcp__echo__read {}", { isError: false, text: "old" });
			expect(await (await post("/templates/delete", { name: "delete-me" })).json()).toEqual({ deleted: true });
			expect(ctx.memory.list(scope)).toEqual([]);
			expect(ctx.memory.listReadShared(scope)).toEqual([]);
			expect(ctx.memory.mcpCache(scope)).toEqual({});
			expect(ctx.memory.get("shared", "template-shared")).toBe("shared value");
			ctx.memory.set("template-dashboard", "keep", 1);
			expect(await (await post("/templates/delete", { name: "dashboard" })).json()).toEqual({ deleted: false });
			expect(ctx.memory.get("template-dashboard", "keep")).toBe(1);
		} finally {
			if (previous === undefined) delete process.env.PI_ARTIFACTS_TEMPLATES;
			else process.env.PI_ARTIFACTS_TEMPLATES = previous;
		}
	});

	it("changes the preview revision and clears MCP cache when a template is saved again", async () => {
		const previous = process.env.PI_ARTIFACTS_TEMPLATES;
		process.env.PI_ARTIFACTS_TEMPLATES = join(dir, "revised-template");
		try {
			const body = { name: "revision", title: "Revision", description: "Test", useCases: ["test"], mcp: ["echo.read"], code: "export default () => null" };
			expect((await post("/templates/save", body)).status).toBe(200);
			const first = await ctx.templateView("revision");
			ctx.memory.set(first.id, "draft", "preserve");
			ctx.memory.cacheMcp(first.id, "mcp__echo__read {}", { isError: false, text: "old" });
			expect((await post("/templates/save", body)).status).toBe(200);
			const second = await ctx.templateView("revision");
			expect(second.instanceId).toBeTruthy();
			expect(second.instanceId).not.toBe(first.instanceId);
			expect(ctx.memory.mcpCache(first.id)).toEqual({});
			expect(ctx.memory.get(first.id, "draft")).toBe("preserve");
		} finally {
			if (previous === undefined) delete process.env.PI_ARTIFACTS_TEMPLATES;
			else process.env.PI_ARTIFACTS_TEMPLATES = previous;
		}
	});

	it.each([false, true])("does not restore a deleted template's MCP cache (external removal: %s)", async (externalRemoval) => {
		const previous = process.env.PI_ARTIFACTS_TEMPLATES;
		process.env.PI_ARTIFACTS_TEMPLATES = join(dir, "pending-template");
		let respond!: () => void;
		let received!: () => void;
		const requestReceived = new Promise<void>((resolve) => { received = resolve; });
		const bridge = createServer((_req, res) => {
			respond = () => { if (!res.writableEnded) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ isError: false, text: "old" })); } };
			received();
		});
		await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
		try {
			const { saveTemplate } = await import("../../../viewer/server/templates.ts");
			const meta = { title: "Test", description: "Test", useCases: ["test"], mcp: ["echo.read"] };
			await saveTemplate("pending", meta, "export default () => null");
			const port = (bridge.address() as AddressInfo).port;
			ctx.sessions.upsert({ sessionId: "pending-template", cwd: "/", bridgeUrl: `http://127.0.0.1:${port}`, bridgeToken: "t", tools: ["mcp__echo__read"] });
			const call = ctx.mcpCall("template-pending", "echo.read", {});
			await requestReceived;
			ctx.memory.set("template-pending", "draft", "keep");
			if (externalRemoval) await rm(join(process.env.PI_ARTIFACTS_TEMPLATES!, "pending"), { recursive: true });
			const deleted = await (await post("/templates/delete", { name: "pending" })).json();
			expect(deleted).toEqual({ deleted: !externalRemoval });
			if (externalRemoval) expect(ctx.memory.get("template-pending", "draft")).toBe("keep");
			await saveTemplate("pending", meta, "export default () => null");
			respond();
			await call;
			expect(ctx.memory.mcpCache("template-pending")).toEqual({});
		} finally {
			respond?.();
			ctx.sessions.remove("pending-template");
			if (previous === undefined) delete process.env.PI_ARTIFACTS_TEMPLATES;
			else process.env.PI_ARTIFACTS_TEMPLATES = previous;
			await new Promise<void>((resolve) => bridge.close(() => resolve()));
		}
	});

	it("does not cache an MCP response started before a template was saved again", async () => {
		const previous = process.env.PI_ARTIFACTS_TEMPLATES;
		process.env.PI_ARTIFACTS_TEMPLATES = join(dir, "updated-template");
		let respond!: () => void;
		let received!: () => void;
		const requestReceived = new Promise<void>((resolve) => { received = resolve; });
		const bridge = createServer((_req, res) => {
			respond = () => { if (!res.writableEnded) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ isError: false, text: "old" })); } };
			received();
		});
		await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
		try {
			const body = { name: "pending", title: "Test", description: "Test", useCases: ["test"], mcp: ["echo.read"], code: "export default () => null" };
			expect((await post("/templates/save", body)).status).toBe(200);
			const port = (bridge.address() as AddressInfo).port;
			ctx.sessions.upsert({ sessionId: "updated-template", cwd: "/", bridgeUrl: `http://127.0.0.1:${port}`, bridgeToken: "t", tools: ["mcp__echo__read"] });
			const call = ctx.mcpCall("template-pending", "echo.read", {});
			await requestReceived;
			expect((await post("/templates/save", body)).status).toBe(200);
			respond();
			await call;
			expect(ctx.memory.mcpCache("template-pending")).toEqual({});
		} finally {
			respond?.();
			ctx.sessions.remove("updated-template");
			if (previous === undefined) delete process.env.PI_ARTIFACTS_TEMPLATES;
			else process.env.PI_ARTIFACTS_TEMPLATES = previous;
			await new Promise<void>((resolve) => bridge.close(() => resolve()));
		}
	});

	it("does not grant MCP access through a malformed global wildcard", async () => {
		await ctx.writeArtifact({ id: "bad-wildcard", title: "Bad wildcard", code: "", mcp: ["mcp__*"] }, 0);
		await expect(ctx.mcpCall("bad-wildcard", "gh.search", {})).rejects.toThrow(/allowlist/);
	});

	it("deleting an artifact forgets its memory", async () => {
		await post("/artifacts/write", { id: "gone", title: "Gone", code: "" });
		await post("/memory", { action: "set", scope: "gone", key: "k", value: 1 });
		expect(await (await post("/artifacts/delete", { id: "gone" })).json()).toEqual({ deleted: true });
		expect(await (await post("/memory", { action: "list", scope: "gone" })).json()).toEqual([]);
	});

	it("does not export a stale MCP success after a later call fails", async () => {
		let fail = false;
		const bridge = createServer((_req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(fail ? { isError: true, text: "unavailable" } : { isError: false, text: "old" }));
		});
		await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
		try {
			const port = (bridge.address() as AddressInfo).port;
			ctx.sessions.upsert({ sessionId: "cache-failure", cwd: "/", bridgeUrl: `http://127.0.0.1:${port}`, bridgeToken: "t", tools: ["mcp__echo__read"] });
			await ctx.writeArtifact({ id: "cache-failure", title: "Test", code: "", mcp: ["echo.read"], sessionId: "cache-failure" }, 0);
			await ctx.mcpCall("cache-failure", "echo.read", {});
			expect(Object.keys(ctx.memory.mcpCache("cache-failure"))).toHaveLength(1);
			fail = true;
			expect((await ctx.mcpCall("cache-failure", "echo.read", {})).isError).toBe(true);
			expect(ctx.memory.mcpCache("cache-failure")).toEqual({});
		} finally {
			ctx.sessions.remove("cache-failure");
			await new Promise<void>((resolve) => bridge.close(() => resolve()));
		}
	});

	it("caches distinct MCP results according to the JSON arguments sent to the bridge", async () => {
		const received: unknown[] = [];
		const bridge = createServer(async (req, res) => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(chunk as Buffer);
			const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			received.push(body.args);
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ isError: false, text: `result-${received.length}` }));
		});
		await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
		try {
			const port = (bridge.address() as AddressInfo).port;
			ctx.sessions.upsert({ sessionId: "json-args", cwd: "/", bridgeUrl: `http://127.0.0.1:${port}`, bridgeToken: "t", tools: ["mcp__echo__read"] });
			await ctx.writeArtifact({ id: "json-args", title: "Test", code: "", mcp: ["echo.read"], sessionId: "json-args" }, 0);
			await ctx.mcpCall("json-args", "echo.read", { date: new Date("2026-11-01T00:00:00.000Z") });
			await ctx.mcpCall("json-args", "echo.read", { date: {} });
			expect(received).toEqual([{ date: "2026-11-01T00:00:00.000Z" }, { date: {} }]);
			expect(Object.keys(ctx.memory.mcpCache("json-args"))).toHaveLength(2);
		} finally {
			ctx.sessions.remove("json-args");
			await new Promise<void>((resolve) => bridge.close(() => resolve()));
		}
	});

	it("keeps the newer MCP result when overlapping calls finish out of order", async () => {
		const responses: (() => void)[] = [];
		const bridge = createServer((_req, res) => {
			const result = responses.length === 0 ? "old" : "new";
			responses.push(() => { if (!res.writableEnded) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ isError: false, text: result })); } });
		});
		await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
		try {
			const port = (bridge.address() as AddressInfo).port;
			ctx.sessions.upsert({ sessionId: "cache-order", cwd: "/", bridgeUrl: `http://127.0.0.1:${port}`, bridgeToken: "t", tools: ["mcp__echo__read"] });
			await ctx.writeArtifact({ id: "cache-order", title: "Test", code: "", mcp: ["echo.read"], sessionId: "cache-order" }, 0);
			const first = ctx.mcpCall("cache-order", "echo.read", {});
			while (responses.length < 1) await new Promise((resolve) => setTimeout(resolve, 5));
			const second = ctx.mcpCall("cache-order", "echo.read", {});
			while (responses.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
			responses[1]();
			await second;
			responses[0]();
			await first;
			expect(ctx.memory.mcpCache("cache-order")["mcp__echo__read {}"].text).toBe("new");
		} finally {
			for (const respond of responses) respond();
			ctx.sessions.remove("cache-order");
			await new Promise<void>((resolve) => bridge.close(() => resolve()));
		}
	});

	it("uses invocation order even when the older call loads metadata later", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		let requests = 0;
		const bridge = createServer((_req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ isError: false, text: ++requests === 1 ? "new" : "old" }));
		});
		await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
		const original = ctx.callerMeta.bind(ctx);
		let lookups = 0;
		const lookup = vi.spyOn(ctx, "callerMeta").mockImplementation(async (id) => {
			if (++lookups === 1) await gate;
			return original(id);
		});
		try {
			const port = (bridge.address() as AddressInfo).port;
			ctx.sessions.upsert({ sessionId: "metadata-order", cwd: "/", bridgeUrl: `http://127.0.0.1:${port}`, bridgeToken: "t", tools: ["mcp__echo__read"] });
			await ctx.writeArtifact({ id: "metadata-order", title: "Test", code: "", mcp: ["echo.read"], sessionId: "metadata-order" }, 0);
			const first = ctx.mcpCall("metadata-order", "echo.read", {});
			await ctx.mcpCall("metadata-order", "echo.read", {});
			release();
			await first;
			expect(ctx.memory.mcpCache("metadata-order")["mcp__echo__read {}"].text).toBe("new");
		} finally {
			release();
			lookup.mockRestore();
			ctx.sessions.remove("metadata-order");
			await new Promise<void>((resolve) => bridge.close(() => resolve()));
		}
	});

	it("does not cache an in-flight MCP result after deletion and recreation", async () => {
		let respond!: () => void;
		let received!: () => void;
		const requestReceived = new Promise<void>((resolve) => { received = resolve; });
		const bridge = createServer((_req, res) => {
			respond = () => { if (!res.writableEnded) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ text: "old result" })); } };
			received();
		});
		await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
		try {
			const port = (bridge.address() as AddressInfo).port;
			ctx.sessions.upsert({ sessionId: "pending", cwd: "/", bridgeUrl: `http://127.0.0.1:${port}`, bridgeToken: "t", tools: ["mcp__echo__read"] });
			await ctx.writeArtifact({ id: "pending-call", title: "Old", code: "", mcp: ["echo.read"], sessionId: "pending" }, 0);
			const call = ctx.mcpCall("pending-call", "echo.read", {});
			await requestReceived;
			await ctx.deleteArtifact("pending-call");
			await ctx.writeArtifact({ id: "pending-call", title: "New", code: "", mcp: ["echo.read"] }, 0);
			respond();
			await call;
			expect(ctx.memory.mcpCache("pending-call")).toEqual({});
		} finally {
			ctx.sessions.remove("pending");
			await new Promise<void>((resolve) => bridge.close(() => resolve()));
		}
	});

	it("invalidates in-flight results when the artifact was already removed externally", async () => {
		let respond!: () => void;
		let received!: () => void;
		const requestReceived = new Promise<void>((resolve) => { received = resolve; });
		const bridge = createServer((_req, res) => {
			respond = () => { if (!res.writableEnded) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ text: "old result" })); } };
			received();
		});
		await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
		try {
			const port = (bridge.address() as AddressInfo).port;
			ctx.sessions.upsert({ sessionId: "external-delete", cwd: "/", bridgeUrl: `http://127.0.0.1:${port}`, bridgeToken: "t", tools: ["mcp__echo__read"] });
			await ctx.writeArtifact({ id: "external-delete", title: "Old", code: "", mcp: ["echo.read"], sessionId: "external-delete" }, 0);
			ctx.memory.set("external-delete", "saved", "keep");
			const call = ctx.mcpCall("external-delete", "echo.read", {});
			await requestReceived;
			await rm(join(dir, "external-delete"), { recursive: true });
			expect(await ctx.deleteArtifact("external-delete")).toBe(false);
			respond();
			await call;
			expect(ctx.memory.mcpCache("external-delete")).toEqual({});
			expect(ctx.memory.get("external-delete", "saved")).toBe("keep");
		} finally {
			respond?.();
			ctx.sessions.remove("external-delete");
			await new Promise<void>((resolve) => bridge.close(() => resolve()));
		}
	});

	it("discards cached and in-flight MCP results when the artifact is rewritten", async () => {
		let respond!: () => void;
		let received!: () => void;
		const requestReceived = new Promise<void>((resolve) => { received = resolve; });
		const bridge = createServer((_req, res) => {
			respond = () => { if (!res.writableEnded) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ isError: false, text: "old result" })); } };
			received();
		});
		await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
		try {
			const port = (bridge.address() as AddressInfo).port;
			ctx.sessions.upsert({ sessionId: "rewrite", cwd: "/", bridgeUrl: `http://127.0.0.1:${port}`, bridgeToken: "t", tools: ["mcp__echo__read"] });
			await ctx.writeArtifact({ id: "rewrite", title: "Old", code: "", mcp: ["echo.read"], sessionId: "rewrite" }, 0);
			ctx.memory.cacheMcp("rewrite", "mcp__echo__read {}", { isError: false, text: "previous" });
			await ctx.writeArtifact({ id: "rewrite", title: "New", code: "", mcp: ["echo.read"] }, 0);
			expect(ctx.memory.mcpCache("rewrite")).toEqual({});
			const call = ctx.mcpCall("rewrite", "echo.read", {});
			await requestReceived;
			await ctx.writeArtifact({ id: "rewrite", title: "Revoked", code: "", mcp: [] }, 0);
			await ctx.writeArtifact({ id: "rewrite", title: "Allowed again", code: "", mcp: ["echo.read"] }, 0);
			respond();
			await call;
			expect(ctx.memory.mcpCache("rewrite")).toEqual({});
		} finally {
			respond?.();
			ctx.sessions.remove("rewrite");
			await new Promise<void>((resolve) => bridge.close(() => resolve()));
		}
	});
});
