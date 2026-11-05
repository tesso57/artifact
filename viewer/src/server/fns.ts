/**
 * Server functions for the browser. They run inside the daemon (Vite's module runner) and
 * delegate to the daemon context; requests are authenticated by the daemon's guard
 * middleware (session cookie, same-origin for writes).
 */
import { createServerFn } from "@tanstack/react-start";
import type { DaemonContext } from "../../server/context.ts";
import { isValidId, SHARED_SCOPE } from "../../../shared/ids.ts";

// The daemon installs its context on globalThis; importing the class here would load a
// second copy of the daemon's modules inside the module runner.
const ctx = () => {
	const c = (globalThis as Record<symbol, unknown>)[Symbol.for("pi-artifacts.daemon")] as DaemonContext | undefined;
	if (!c) throw new Error("The viewer must run inside the pi-artifacts daemon");
	return c;
};

function id(v: unknown): string {
	if (!isValidId(v)) throw new Error(`Invalid id ${JSON.stringify(v)}`);
	return v;
}

// ---- artifacts & templates ------------------------------------------------------------

export const listArtifactsFn = createServerFn({ method: "GET" }).handler(() => ctx().listArtifacts());

export const getArtifactFn = createServerFn({ method: "GET" })
	.validator(id)
	.handler(({ data }) => ctx().artifactView(data));

export const getTemplatePreviewFn = createServerFn({ method: "GET" })
	.validator(id)
	.handler(({ data }) => ctx().templateView(data));

export const getCodeFn = createServerFn({ method: "GET" })
	.validator((d: { moduleUrl: string }) => ({ moduleUrl: String(d.moduleUrl) }))
	.handler(({ data }) => ctx().moduleSource(data.moduleUrl));

export const exportArtifactFn = createServerFn({ method: "POST" })
	.validator(id)
	.handler(async ({ data }) => {
		const r = await ctx().exportArtifact(data);
		return { html: r.html, bytes: r.bytes, fileName: `${data}.html`, embedded: r.embedded };
	});

// ---- runtime feedback -------------------------------------------------------------------

export const pingFn = createServerFn({ method: "POST" })
	.validator(id)
	.handler(({ data }) => {
		ctx().noteViewing(data);
		return null;
	});

export const reportErrorFn = createServerFn({ method: "POST" })
	.validator((d: { id: string; message: string; stack?: string }) => ({ ...d, id: id(d.id), message: String(d.message) }))
	.handler(({ data }) => {
		ctx().reportError(data.id, data.message, data.stack);
		return null;
	});

// ---- memory (SQLite) ---------------------------------------------------------------------

type Scoped = { scope: string; key: string; from?: string };

function scoped<T extends { key: unknown }>(d: T): T & { key: string } {
	if (typeof d.key !== "string" || d.key.length === 0 || d.key.length > 512) throw new Error("Memory keys are non-empty strings (max 512)");
	return d as T & { key: string };
}

export const memoryGetFn = createServerFn({ method: "POST" })
	.validator((d: Scoped) => scoped(d))
	.handler(({ data }) => {
		const value = ctx().memory.get(ctx().scope(data.scope, data.from, data.key), data.key);
		// `found` keeps a stored `null` apart from a missing key (undefined does not serialize).
		return { found: value !== undefined, value: (value ?? null) as never };
	});

export const memorySetFn = createServerFn({ method: "POST" })
	.validator((d: Scoped & { value: unknown }) => scoped(d))
	// undefined (dropped by serialization) deletes the key, as in exports.
	.handler(({ data }) => ({ updatedAt: ctx().memory.set(ctx().scope(data.scope), data.key, data.value).updatedAt }));

export const memoryDeleteFn = createServerFn({ method: "POST" })
	.validator((d: Scoped) => scoped(d))
	.handler(({ data }) => ({ deleted: ctx().memory.delete(ctx().scope(data.scope), data.key) }));

export const memoryListFn = createServerFn({ method: "POST" })
	.validator((d: { scope: string; prefix?: string; from?: string }) => d)
	.handler(({ data }) =>
		ctx()
			.memory.list(ctx().scope(data.scope, data.from, data.scope === SHARED_SCOPE ? "*" : undefined), data.prefix)
			.map((e) => ({ key: e.key, value: e.value as never, updatedAt: e.updatedAt })),
	);

// ---- MCP (routed to a pi session's bridge) -----------------------------------------------

export const mcpStatusFn = createServerFn({ method: "GET" }).handler(() => ctx().mcpStatus());

export const mcpListToolsFn = createServerFn({ method: "GET" }).handler(async () =>
	(await ctx().mcpTools()).map((t) => ({ ...t, inputSchema: t.inputSchema as never })),
);

export const mcpCallFn = createServerFn({ method: "POST" })
	.validator((d: { name: string; args?: Record<string, unknown>; artifactId: string }) => d)
	.handler(async ({ data }) => {
		const r = await ctx().mcpCall(data.artifactId, data.name, data.args ?? {});
		return { ...r, data: (r.data ?? null) as never };
	});
