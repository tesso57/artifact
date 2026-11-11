import { afterEach, describe, expect, it, vi } from "vitest";
import { Memory } from "../../../viewer/server/memory.ts";

function fakeIndexedDb(abortAfterRun = false) {
	return { open: vi.fn(() => {
		const request: any = {};
		const database = {
			close() {},
			transaction() {
				let aborted = false;
				const transaction: any = {
					error: abortAfterRun ? new Error("injected abort") : null,
					abort() { aborted = true; queueMicrotask(() => transaction.onabort?.()); },
					objectStore() { return { get() {
						const read: any = {};
						queueMicrotask(() => { read.onsuccess?.(); if (!aborted) queueMicrotask(() => abortAfterRun ? transaction.onabort?.() : transaction.oncomplete?.()); });
						return read;
					} }; },
				};
				return transaction;
			},
		};
		request.result = database;
		queueMicrotask(() => request.onsuccess?.());
		return request;
	}) };
}

function stubWindow(value: Record<string, unknown>) {
	vi.stubGlobal("window", { indexedDB: fakeIndexedDb(), ...value });
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe("exported memory", () => {
	it("compares values under the storage lock before updating", async () => {
		const storage = new Map<string, string>();
		const indexedDB = fakeIndexedDb();
		stubWindow({ indexedDB, __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		expect(await backend.memoryCompareSet("demo", "key", { found: false }, 1)).toBe(true);
		expect(await backend.memoryCompareSet("demo", "key", { found: false }, 2)).toBe(false);
		expect(await backend.memoryGet("demo", "key")).toBe(1);
		expect(await backend.memoryCompareSet("demo", "key", { found: true, value: 1 }, 2)).toBe(true);
		expect(await backend.memoryGet("demo", "key")).toBe(2);
		expect(indexedDB.open).toHaveBeenCalledTimes(3);
		expect(indexedDB.open).toHaveBeenCalledWith("pi-artifacts-memory-coordination-v2:pi-artifact:demo:1", 1);
	});

	it("refuses unsafe offline writes when no coordination API is available", async () => {
		stubWindow({ indexedDB: undefined, __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		await expect(backend.memoryCompareSet("demo", "key", { found: false }, 1)).rejects.toThrow(/coordinate/);
		await expect(backend.memorySet("demo", "key", 1)).rejects.toThrow(/coordinate/);
		await expect(backend.memoryDelete("demo", "key")).rejects.toThrow(/coordinate/);
	});

	it("reports an uncertain outcome if coordination aborts after storage was written", async () => {
		const storage = new Map<string, string>();
		stubWindow({ indexedDB: fakeIndexedDb(true), __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		await expect(backend.memorySet("demo", "key", 1)).rejects.toThrow(/may have completed.*coordination failed/i);
		expect([...storage.values()][0]).toContain('"value":1');
	});

	it("does not write when a delayed lock callback arrives after timeout", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			const read: any = {};
			const transaction: any = { abort: vi.fn(), objectStore: () => ({ get: () => read }) };
			const request: any = { result: { transaction: () => transaction, close: vi.fn() } };
			stubWindow({ indexedDB: { open: () => request }, __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [], mcp: {} } });
			const setItem = vi.fn();
			vi.stubGlobal("localStorage", { getItem: () => null, setItem });
			const { backend } = await import("../../../viewer/src/export/static-backend");
			const write = backend.memorySet("demo", "key", 1);
			const rejected = expect(write).rejects.toThrow(/coordinate.*time/i);
			request.onsuccess();
			await vi.advanceTimersByTimeAsync(10_000);
			await rejected;
			read.onsuccess();
			expect(setItem).not.toHaveBeenCalled();
		} finally { vi.useRealTimers(); }
	});
	it("keeps exports with the same timestamp in separate storage", async () => {
		const storage = new Map<string, string>();
		const windowValue = { __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, snapshotId: "first", memory: [], mcp: {} } };
		stubWindow(windowValue);
		vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
		let { backend } = await import("../../../viewer/src/export/static-backend");
		await backend.memorySet("demo", "key", "first value");
		windowValue.__PI_ARTIFACT__.snapshotId = "second";
		vi.resetModules();
		({ backend } = await import("../../../viewer/src/export/static-backend"));
		expect(await backend.memoryGet("demo", "key")).toBeUndefined();
		await backend.memorySet("demo", "key", "second value");
		windowValue.__PI_ARTIFACT__.snapshotId = "first";
		vi.resetModules();
		({ backend } = await import("../../../viewer/src/export/static-backend"));
		expect(await backend.memoryGet("demo", "key")).toBe("first value");
	});
	it.each(["null", "[]", "42", '"text"', '{"demo\\u0000saved":null}', '{"demo\\u0000saved":{"updatedAt":1}}'])("does not overwrite malformed saved memory: %s", async (saved) => {
		const setItem = vi.fn();
		stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: () => saved, setItem });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		await expect(backend.memoryGet("demo", "saved")).rejects.toThrow(/read artifact memory/i);
		await expect(backend.memoryList("demo")).rejects.toThrow(/read artifact memory/i);
		await expect(backend.memorySet("demo", "new", 1)).rejects.toThrow(/read artifact memory/i);
		await expect(backend.memoryDelete("demo", "saved")).rejects.toThrow(/read artifact memory/i);
		expect(setItem).not.toHaveBeenCalled();
	});
	it("reports a storage read failure and can read the saved state after recovery", async () => {
		let unavailable = true;
		stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [{ scope: "demo", key: "saved", value: "stale", updatedAt: 1 }], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: () => { if (unavailable) throw new Error("access denied"); return '{"demo\\u0000saved":{"value":"current","updatedAt":2}}'; }, setItem: () => {} });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		await expect(backend.memoryGet("demo", "saved")).rejects.toThrow(/read artifact memory/i);
		unavailable = false;
		expect(await backend.memoryGet("demo", "saved")).toBe("current");
	});
	it("replays MCP data using the JSON representation of arguments", async () => {
		stubWindow({ __PI_ARTIFACT__: {
			artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [],
			mcp: { 'mcp__x__y {"date":"2026-11-01T00:00:00.000Z"}': { isError: false, text: "saved" } },
		} });
		vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		expect(await backend.mcpCall("mcp__x__y", { date: new Date("2026-11-01T00:00:00.000Z") }, "demo")).toEqual({ isError: false, text: "saved" });
	});
	it("does not let callers mutate later offline MCP results", async () => {
		stubWindow({ __PI_ARTIFACT__: {
			artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [],
			mcp: { 'mcp__x__y {}': { isError: false, text: "saved", data: { items: ["original"] } } },
		} });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		const first = await backend.mcpCall("mcp__x__y", {}, "demo");
		(first.data as { items: string[] }).items.push("changed");
		first.text = "changed";
		expect(await backend.mcpCall("mcp__x__y", {}, "demo")).toEqual({ isError: false, text: "saved", data: { items: ["original"] } });
	});
	it("rejects invalid scopes before they can collide with another key", async () => {
		stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [{ scope: "demo", key: "other\0key", value: "saved", updatedAt: 1 }], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		for (const scope of ["demo\0other", "", "../demo", "UPPER"]) {
			await expect(backend.memoryGet(scope, "key")).rejects.toThrow(/scope/i);
			await expect(backend.memorySet(scope, "key", "changed")).rejects.toThrow(/scope/i);
			await expect(backend.memoryDelete(scope, "key")).rejects.toThrow(/scope/i);
			await expect(backend.memoryList(scope)).rejects.toThrow(/scope/i);
		}
		expect(await backend.memoryGet("demo", "other\0key")).toBe("saved");
	});
	it("rejects new keys with unpaired surrogates", async () => {
		stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [{ scope: "demo", key: "legacy\ud800", value: "old", updatedAt: 1 }], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		await expect(backend.memorySet("demo", "x\ud800", 1)).rejects.toThrow(/Unicode/i);
		await expect(backend.memorySet("demo", "x\udc00", 1)).rejects.toThrow(/Unicode/i);
		await expect(backend.memorySet("demo", "x😀", 1)).resolves.toBeUndefined();
		expect(await backend.memoryGet("demo", "legacy\ud800")).toBe("old");
		expect(await backend.memoryDelete("demo", "legacy\ud800")).toBe(true);
	});
	it("lists Unicode keys in the same order as the live SQLite backend", async () => {
		const live = new Memory(":memory:");
		try {
			const keys = ["😀", "\uE000", "日本語", "a"];
			for (const key of keys) live.set("demo", key, key);
			stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: live.list("demo"), mcp: {} } });
			vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
			const { backend } = await import("../../../viewer/src/export/static-backend");
			expect((await backend.memoryList("demo")).map((row) => row.key)).toEqual(live.list("demo").map((row) => row.key));
		} finally {
			live.close();
		}
	});

	it("matches Unicode prefixes the same way as live SQLite", async () => {
		const live = new Memory(":memory:");
		try {
			for (const key of ["😀task", "�task", "abc"]) live.set("demo", key, key);
			stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: live.list("demo"), mcp: {} } });
			vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
			const { backend } = await import("../../../viewer/src/export/static-backend");
			for (const prefix of ["😀", "\ud83d", "�", "a"]) {
				expect((await backend.memoryList("demo", prefix)).map((row) => row.key)).toEqual(live.list("demo", prefix).map((row) => row.key));
			}
		} finally { live.close(); }
	});
	it("keeps snapshot keys deleted after the exported page reloads", async () => {
		const storage = new Map<string, string>();
		stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [{ scope: "demo", key: "saved", value: "old", updatedAt: 1 }], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
		let { backend } = await import("../../../viewer/src/export/static-backend");
		expect(await backend.memoryGet("demo", "saved")).toBe("old");
		await backend.memoryDelete("demo", "saved");
		vi.resetModules();
		({ backend } = await import("../../../viewer/src/export/static-backend"));
		expect(await backend.memoryGet("demo", "saved")).toBeUndefined();
		expect(await backend.memoryList("demo")).toEqual([]);
	});

	it("lists complete keys containing a NUL character", async () => {
		stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		await backend.memorySet("demo", "a\0first", 3);
		expect((await backend.memoryList("demo", "a\0f")).map((row) => row.key)).toEqual(["a\0first"]);
	});

	it("reports storage failures without changing the in-memory snapshot", async () => {
		stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [{ scope: "demo", key: "saved", value: "old", updatedAt: 1 }], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("storage full"); } });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		await expect(backend.memorySet("demo", "saved", "new")).rejects.toThrow(/save/i);
		expect(await backend.memoryGet("demo", "saved")).toBe("old");
		await expect(backend.memoryDelete("demo", "saved")).rejects.toThrow(/save/i);
		expect(await backend.memoryGet("demo", "saved")).toBe("old");
	});

	it("does not let callers mutate saved JSON through object references", async () => {
		stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		const original = { items: ["saved"] };
		await backend.memorySet("demo", "key", original);
		original.items.push("external change");
		const read = await backend.memoryGet("demo", "key") as typeof original;
		expect(read).toEqual({ items: ["saved"] });
		read.items.push("read change");
		const listed = await backend.memoryList("demo");
		(listed[0].value as typeof original).items.push("list change");
		expect(await backend.memoryGet("demo", "key")).toEqual({ items: ["saved"] });
	});

	it("rejects values that cannot be represented as JSON", async () => {
		stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		await expect(backend.memorySet("demo", "key", () => {})).rejects.toThrow(/JSON/);
		expect(await backend.memoryList("demo")).toEqual([]);
	});

	it("preserves changes from another open copy before writing", async () => {
		const storage = new Map<string, string>();
		stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
		const first = (await import("../../../viewer/src/export/static-backend")).backend;
		await first.memoryList("demo");
		vi.resetModules();
		const second = (await import("../../../viewer/src/export/static-backend")).backend;
		await second.memoryList("demo");
		await first.memorySet("demo", "first", 1);
		await second.memorySet("demo", "second", 2);
		vi.resetModules();
		const reloaded = (await import("../../../viewer/src/export/static-backend")).backend;
		expect((await reloaded.memoryList("demo")).map(({ key }) => key)).toEqual(["first", "second"]);
	});

	it("rejects oversized new keys but can read and delete legacy keys", async () => {
		const storage = new Map<string, string>();
		const key = "x".repeat(513);
		stubWindow({ __PI_ARTIFACT__: { artifact: { id: "demo", title: "Demo" }, exportedAt: 1, memory: [{ scope: "demo", key, value: "old", updatedAt: 1 }], mcp: {} } });
		vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, value: string) => storage.set(k, value) });
		const { backend } = await import("../../../viewer/src/export/static-backend");
		await expect(backend.memorySet("demo", key, "new")).rejects.toThrow(/512/);
		expect(await backend.memoryGet("demo", key)).toBe("old");
		expect(await backend.memoryDelete("demo", key)).toBe(true);
	});
});
