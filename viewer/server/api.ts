/**
 * HTTP surface of the daemon:
 *  - guardMiddleware: every request needs the session cookie (browser) or the secret
 *    header (pi extension); state-changing browser requests must be same-origin.
 *  - apiMiddleware: `/__pi/login`, `/__pi/theme.css` and the extension's `/__pi/api/*`.
 */
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Connect } from "vite";
import { assertArtifactId } from "../../shared/ids.ts";
import { BUNDLED_TEMPLATES_DIR, designDir, userTemplatesDir } from "../../shared/paths.ts";
import { DAEMON_SECRET_HEADER, PROTOCOL_VERSION, type SessionRegistration } from "../../shared/protocol.ts";
import type { DaemonContext } from "./context.ts";
import { listArtifacts } from "./store.ts";
import { deleteTemplate, getTemplate, listTemplates, saveTemplate } from "./templates.ts";

const MAX_BODY = 4 * 1024 * 1024;

function cookie(req: IncomingMessage, name: string): string | undefined {
	for (const part of (req.headers.cookie ?? "").split(";")) {
		const [k, ...v] = part.trim().split("=");
		if (k === name) return decodeURIComponent(v.join("="));
	}
	return undefined;
}

function send(res: ServerResponse, status: number, body: unknown) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.setHeader("cache-control", "no-store");
	res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
		chunks.push(chunk as Buffer);
	}
	return (chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}) as T;
}

function contentSecurityPolicy(ctx: DaemonContext): string {
	// Artifacts run in the viewer's origin: keep them from sending data anywhere else.
	return [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		`connect-src 'self' ws://127.0.0.1:${ctx.port} ws://localhost:${ctx.port}`,
		"frame-ancestors 'none'",
		"form-action 'self'",
		"base-uri 'none'",
	].join("; ");
}

/** Same-origin check for browser requests that change state. */
function sameOrigin(req: IncomingMessage, ctx: DaemonContext): boolean {
	if (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(String(req.headers["sec-fetch-site"]))) return false;
	const origin = req.headers.origin;
	if (!origin) return true;
	return origin === ctx.origin || origin === `http://localhost:${ctx.port}`;
}

export function guardMiddleware(ctx: DaemonContext): Connect.NextHandleFunction {
	return (req, res, next) => {
		res.setHeader("content-security-policy", contentSecurityPolicy(ctx));
		res.setHeader("x-content-type-options", "nosniff");
		res.setHeader("referrer-policy", "no-referrer");
		const path = (req.url ?? "/").split("?")[0];
		if (path === "/__pi/login") return next();
		// Vite's open-in-editor endpoint would let page scripts open files in the user's editor.
		if (path.startsWith("/__open-in-editor")) return send(res, 403, { error: "Forbidden" });
		if (ctx.isSecret(req.headers[DAEMON_SECRET_HEADER])) return next();
		// The open-tab banner polls this; it must not keep an idle daemon alive.
		if (path === "/__pi/session") return send(res, ctx.browserSession(cookie(req, ctx.cookieName)) ? 200 : 401, {});
		if (ctx.isSecret(req.headers[DAEMON_SECRET_HEADER])) ctx.touch();
		if (ctx.browserSession(cookie(req, ctx.cookieName)) && !path.startsWith("/__pi/api/")) {
			ctx.touch();
			if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req, ctx)) {
				return send(res, 403, { error: "Cross-origin request refused" });
			}
			return next();
		}
		unauthorized(res);
	};
}

function unauthorized(res: ServerResponse) {
	res.statusCode = 401;
	res.setHeader("content-type", "text/html; charset=utf-8");
	res.end(
		`<!doctype html><meta charset="utf-8"><title>pi artifacts</title><body style="font:14px system-ui;padding:3rem;max-width:40rem">` +
			`<h1 style="font-size:1.25rem">Open this from pi</h1><p>The artifact viewer only accepts links created by pi (they expire after 30 minutes). Run <code>/artifacts</code> in pi, or ask the agent for a new link.</p>`,
	);
}

type Handler = (ctx: DaemonContext, body: any, url: URL) => Promise<unknown> | unknown;

const routes: Record<string, Handler> = {
	"GET /health": (ctx) => ({ protocol: PROTOCOL_VERSION, version: ctx.version, pid: process.pid, port: ctx.port, sessions: ctx.sessions.size }),
	"POST /shutdown": (ctx) => {
		// After the response is sent; process.kill(SIGTERM) would skip cleanup on Windows.
		setTimeout(() => ctx.onShutdown(), 50);
		return { ok: true };
	},
	"POST /sessions/register": (ctx, body: SessionRegistration) => {
		if (!body?.sessionId || !body.bridgeUrl || !body.bridgeToken) throw new Error("sessionId, bridgeUrl and bridgeToken are required");
		ctx.sessions.upsert(body);
		return { ok: true };
	},
	"POST /sessions/unregister": (ctx, body: { sessionId: string }) => {
		ctx.sessions.remove(body.sessionId);
		return { ok: true };
	},
	"POST /link": (ctx, body: { next?: string }) => ({ url: ctx.link(body.next ?? "/") }),

	"GET /artifacts": () => listArtifacts(),
	"POST /artifacts/write": async (ctx, body) => {
		if (body.id !== undefined) assertArtifactId(body.id);
		if (typeof body.title !== "string" || typeof body.code !== "string") throw new Error("title and code are required");
		const r = await ctx.writeArtifact({
			id: body.id,
			title: body.title,
			description: body.description,
			code: body.code,
			cwd: body.cwd,
			sessionId: body.sessionId,
			mcp: Array.isArray(body.mcp) ? body.mcp.map(String) : undefined,
		});
		return { ...r, url: `${ctx.origin}/a/${r.meta.id}`, link: ctx.link(`/a/${r.meta.id}`) };
	},
	"POST /artifacts/delete": async (ctx, body) => {
		assertArtifactId(body.id);
		return { deleted: await ctx.deleteArtifact(body.id) };
	},
	"POST /export": async (ctx, body: { id: string; outFile?: string; overwrite?: boolean }) => {
		assertArtifactId(body.id);
		const outFile = body.outFile ? resolve(body.outFile) : undefined;
		if (outFile && !/\.html?$/i.test(outFile)) throw new Error("Exports must be written to an .html file");
		// Fail fast before bundling; the write itself also refuses to replace files ("wx").
		if (outFile && !body.overwrite && existsSync(outFile)) throw new Error(`${outFile} already exists`);
		const r = await ctx.exportArtifact(body.id, outFile, body.overwrite === true);
		return { file: r.file, bytes: r.bytes, embedded: r.embedded };
	},

	"POST /memory": (ctx, body: { action: string; scope: string; key?: string; value?: unknown }) => {
		const scope = ctx.scope(body.scope);
		const key = () => {
			if (typeof body.key !== "string" || !body.key) throw new Error(`"key" is required for ${body.action}`);
			if (body.key === "*") throw new Error('"*" cannot be a memory key');
			return body.key;
		};
		switch (body.action) {
			case "list":
				return ctx.memory.list(scope).map((e) => ({ key: e.key, value: e.value }));
			case "get":
				return ctx.memory.get(scope, key()) ?? null;
			case "set":
				ctx.memory.set(scope, key(), body.value);
				ctx.memoryChanged(scope);
				return { ok: true };
			case "delete": {
				const deleted = ctx.memory.delete(scope, key());
				ctx.memoryChanged(scope);
				return { deleted };
			}
			default:
				throw new Error(`Unknown memory action ${JSON.stringify(body.action)}`);
		}
	},

	"GET /templates": async () => ({
		templates: (await listTemplates(BUNDLED_TEMPLATES_DIR)).map(({ path: _p, ...t }) => t),
		userTemplatesDir: userTemplatesDir(),
		designDir: designDir(),
	}),
	"GET /templates/get": async (_ctx, _b, url) => {
		const t = await getTemplate(url.searchParams.get("name") ?? "", BUNDLED_TEMPLATES_DIR);
		if (!t) throw new Error(`No template "${url.searchParams.get("name")}"`);
		return t;
	},
	"POST /templates/save": async (ctx, body) => {
		const info = await saveTemplate(
			body.name,
			{ title: body.title, description: body.description, useCases: body.useCases ?? [], tags: body.tags, mcp: body.mcp },
			body.code,
		);
		const compileError = await ctx.compileCheck(info.path);
		return { info, compileError, previewLink: compileError ? undefined : ctx.link(`/t/${body.name}`) };
	},
	"POST /templates/delete": async (_ctx, body) => ({ deleted: await deleteTemplate(body.name) }),
};

export function apiMiddleware(ctx: DaemonContext): Connect.NextHandleFunction {
	return async (req, res, next) => {
		const url = new URL(req.url ?? "/", ctx.origin);

		if (url.pathname === "/__pi/login") {
			const token = url.searchParams.get("t");
			res.statusCode = 302;
			if (ctx.browserSession(cookie(req, ctx.cookieName))) {
				// Already signed in (e.g. the same link clicked again): just go there.
				res.setHeader("location", ctx.followLink(token) ?? "/");
				return res.end();
			}
			const login = ctx.login(token);
			if (!login) return unauthorized(res);
			res.setHeader("set-cookie", `${ctx.cookieName}=${login.session}; Path=/; HttpOnly; SameSite=Strict`);
			res.setHeader("location", login.next);
			return res.end();
		}
		if (url.pathname === "/__pi/theme.css") {
			res.setHeader("content-type", "text/css; charset=utf-8");
			res.setHeader("cache-control", "no-store");
			return res.end(await ctx.themeCss());
		}
		if (!url.pathname.startsWith("/__pi/api/")) return next();
		if (!ctx.isSecret(req.headers[DAEMON_SECRET_HEADER])) return send(res, 401, { error: "Unauthorized" });

		const handler = routes[`${req.method} ${url.pathname.slice("/__pi/api".length)}`];
		if (!handler) return send(res, 404, { error: "Not found" });
		try {
			const body = req.method === "POST" ? await readJson(req) : undefined;
			send(res, 200, (await handler(ctx, body, url)) ?? null);
		} catch (error) {
			const e = error as Error & { status?: number };
			send(res, e.status ?? 400, { error: e.message });
		}
	};
}

