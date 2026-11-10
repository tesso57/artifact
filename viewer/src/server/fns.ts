/**
 * Server functions for the browser. They run inside the daemon (Vite's module runner) and
 * delegate to the daemon context; requests are authenticated by the daemon's guard
 * middleware (session cookie, same-origin for writes).
 */
import { createServerFn } from "@tanstack/react-start";
import type { DaemonContext } from "../../server/context.ts";
import { assertMemoryKey, isValidId, isValidRuntimeId, SHARED_SCOPE } from "../../../shared/ids.ts";
import type { MemorySnapshot } from "../../../shared/protocol.ts";

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

function runtimeId(v: unknown): string {
	if (!isValidRuntimeId(v)) throw new Error(`Invalid id ${JSON.stringify(v)}`);
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
	.validator(runtimeId)
	.handler(({ data }) => {
		ctx().noteViewing(data);
		return null;
	});

export const reportErrorFn = createServerFn({ method: "POST" })
	.validator((d: { id: string; message: string; stack?: string }) => ({ ...d, id: runtimeId(d.id), message: String(d.message) }))
	.handler(({ data }) => {
		ctx().reportError(data.id, data.message, data.stack);
		return null;
	});

// ---- memory (SQLite) ---------------------------------------------------------------------

type Scoped = { scope: string; key: string; from?: string };

function scoped<T extends { key: unknown }>(d: T, forWrite = false): T & { key: string } {
	assertMemoryKey(d.key, forWrite);
	return d as T & { key: string };
}

export const memoryGetFn = createServerFn({ method: "POST" })
	.validator((d: Scoped) => scoped(d))
	.handler(({ data }) => {
		const c = ctx();
		const scope = c.scope(data.scope);
		const value = c.memory.get(scope, data.key);
		if (value !== undefined && scope === SHARED_SCOPE && isValidRuntimeId(data.from)) c.memory.noteSharedRead(data.from, data.key);
		// `found` keeps a stored `null` apart from a missing key (undefined does not serialize).
		return { found: value !== undefined, value: (value ?? null) as never };
	});

export const memorySetFn = createServerFn({ method: "POST" })
	.validator((d: Scoped & { value: unknown }) => scoped(d, d.value !== undefined))
	// undefined (dropped by serialization) deletes the key, as in exports.
	.handler(({ data }) => {
		const scope = ctx().scope(data.scope);
		const entry = ctx().memory.set(scope, data.key, data.value);
		ctx().memoryChanged(scope);
		return { updatedAt: entry.updatedAt };
	});

export const memoryCompareSetFn = createServerFn({ method: "POST" })
	.validator((d: Scoped & { expected: MemorySnapshot; value?: unknown }) => {
		scoped(d, d.value !== undefined);
		if (!d.expected || typeof d.expected.found !== "boolean" || (d.expected.found && d.expected.value === undefined)) throw new Error("Invalid expected memory value");
		return d;
	})
	.handler(({ data }) => {
		const c = ctx();
		const scope = c.scope(data.scope);
		const updated = c.memory.compareAndSet(scope, data.key, data.expected, data.value);
		if (updated) c.memoryChanged(scope);
		return { updated };
	});

export const memoryDeleteFn = createServerFn({ method: "POST" })
	.validator((d: Scoped) => scoped(d))
	.handler(({ data }) => {
		const scope = ctx().scope(data.scope);
		const deleted = ctx().memory.delete(scope, data.key);
		if (deleted) ctx().memoryChanged(scope);
		return { deleted };
	});

export const memoryListFn = createServerFn({ method: "POST" })
	.validator((d: { scope: string; prefix?: string; from?: string }) => d)
	.handler(({ data }) => {
		const c = ctx();
		const scope = c.scope(data.scope);
		const entries = c.memory.list(scope, data.prefix);
		if (scope === SHARED_SCOPE && isValidRuntimeId(data.from)) {
			for (const entry of entries) c.memory.noteSharedRead(data.from, entry.key);
		}
		return entries.map((e) => ({ key: e.key, value: e.value as never, updatedAt: e.updatedAt }));
	});

// ---- MCP (routed to a pi session's bridge) -----------------------------------------------

export const mcpStatusFn = createServerFn({ method: "GET" }).handler(() => ctx().mcpStatus());

export const mcpListToolsFn = createServerFn({ method: "GET" }).handler(async () =>
	(await ctx().mcpTools()).map((t) => ({ ...t, inputSchema: t.inputSchema as never })),
);

export const mcpCallFn = createServerFn({ method: "POST" })
	.validator((d: { name: string; args?: Record<string, unknown>; artifactId: string }) => d)
	.handler(async ({ data }) => {
		const r = await ctx().mcpCall(data.artifactId, data.name, data.args ?? {});
		const { data: resultData, ...rest } = r;
		return resultData === undefined ? rest : { ...rest, data: resultData as never };
	});
