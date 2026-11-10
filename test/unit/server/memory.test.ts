import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Memory } from "../../../viewer/server/memory.ts";

describe("Memory", () => {
	it("stores JSON values per scope", () => {
		const m = new Memory(":memory:");
		m.set("a", "count", 1);
		m.set("a", "todos", ["x", { done: true }]);
		m.set("b", "count", 99);
		expect(m.get("a", "count")).toBe(1);
		expect(m.get("a", "todos")).toEqual(["x", { done: true }]);
		expect(m.get("b", "count")).toBe(99);
		expect(m.get("a", "missing")).toBeUndefined();
		m.close();
	});

	it("upserts, lists by literal prefix, deletes; undefined deletes", () => {
		const m = new Memory(":memory:");
		m.set("s", "user:1", "ann");
		m.set("s", "user:2", "bob");
		m.set("s", "a_b", 1);
		m.set("s", "axb", 2);
		m.set("s", "user:1", "ann2");
		expect(m.list("s", "user:").map((e) => [e.key, e.value])).toEqual([
			["user:1", "ann2"],
			["user:2", "bob"],
		]);
		expect(m.list("s", "a_").map((e) => e.key)).toEqual(["a_b"]);
		expect(m.delete("s", "axb")).toBe(true);
		expect(m.delete("s", "axb")).toBe(false);
		m.set("s", "a_b", undefined);
		expect(m.get("s", "a_b")).toBeUndefined();
		m.close();
	});

	it("compares the saved value atomically before setting or deleting", () => {
		const memory = new Memory(":memory:");
		try {
			expect(memory.compareAndSet("s", "key", { found: false }, null)).toBe(true);
			expect(memory.compareAndSet("s", "key", { found: false }, "wrong")).toBe(false);
			expect(memory.get("s", "key")).toBeNull();
			expect(memory.compareAndSet("s", "key", { found: true, value: null }, { b: 2, a: 1 })).toBe(true);
			expect(memory.compareAndSet("s", "key", { found: true, value: { a: 1, b: 2 } }, undefined)).toBe(true);
			expect(memory.get("s", "key")).toBeUndefined();
		} finally { memory.close(); }
	});

	it("rolls back a failed compare-and-set and permits a later update", () => {
		const memory = new Memory(":memory:");
		try {
			memory.set("s", "key", 1);
			expect(() => memory.compareAndSet("s", "key", { found: true, value: 1 }, 1n)).toThrow();
			expect(memory.get("s", "key")).toBe(1);
			expect(memory.compareAndSet("s", "key", { found: true, value: 1 }, 2)).toBe(true);
			expect(memory.get("s", "key")).toBe(2);
		} finally { memory.close(); }
	});

	it("rejects a stale comparison from another database connection", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-memory-compare-"));
		const path = join(dir, "memory.sqlite");
		const first = new Memory(path);
		const second = new Memory(path);
		try {
			first.set("s", "key", 0);
			expect(second.get("s", "key")).toBe(0);
			expect(first.compareAndSet("s", "key", { found: true, value: 0 }, 1)).toBe(true);
			expect(second.compareAndSet("s", "key", { found: true, value: 0 }, 1)).toBe(false);
			expect(second.get("s", "key")).toBe(1);
		} finally { second.close(); first.close(); rmSync(dir, { recursive: true, force: true }); }
	});

	it("matches literal prefixes containing supplementary characters and NUL", () => {
		const m = new Memory(":memory:");
		m.set("s", "📌task", 1);
		m.set("s", "📌other", 2);
		m.set("s", "a\0first", 3);
		m.set("s", "a\0second", 4);
		expect(m.list("s", "📌").map((e) => e.key)).toEqual(["📌other", "📌task"]);
		expect(m.list("s", "a\0f").map((e) => e.key)).toEqual(["a\0first"]);
		m.close();
	});

	it("caches MCP results per artifact without raw content", () => {
		const m = new Memory(":memory:");
		m.cacheMcp("art", "mcp__x__y {}", { isError: false, text: "t", data: { n: 1 }, content: [{ huge: true }] } as never);
		expect(m.mcpCache("art")).toEqual({ "mcp__x__y {}": { isError: false, text: "t", data: { n: 1 } } });
		expect(m.mcpCache("other")).toEqual({});
		m.close();
	});

	it("records shared reads and forgets everything of a deleted artifact", () => {
		const m = new Memory(":memory:");
		m.set("art", "k", 1);
		m.set("shared", "theme", "dark");
		m.noteSharedRead("art", "theme");
		m.noteSharedRead("art", "theme");
		m.cacheMcp("art", "c", { isError: false, text: "" });
		expect(m.listReadShared("art").map((row) => row.key)).toEqual(["theme"]);
		m.forget("art");
		expect(m.list("art")).toEqual([]);
		expect(m.mcpCache("art")).toEqual({});
		expect(m.listReadShared("art")).toEqual([]);
		expect(m.get("shared", "theme")).toBe("dark");
		m.close();
	});

	it("rolls back all artifact data if cleanup fails partway through", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-memory-forget-"));
		const path = join(dir, "memory.sqlite");
		const memory = new Memory(path);
		const control = new DatabaseSync(path);
		try {
			memory.set("art", "key", "keep");
			memory.set("shared", "shared-key", "shared");
			memory.noteSharedRead("art", "shared-key");
			memory.cacheMcp("art", "call", { isError: false, text: "cached" });
			control.exec("CREATE TRIGGER fail_cache_delete BEFORE DELETE ON mcp_cache BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
			expect(() => memory.forget("art")).toThrow(/injected failure/);
			expect(memory.get("art", "key")).toBe("keep");
			expect(memory.listReadShared("art").map((entry) => entry.key)).toEqual(["shared-key"]);
			expect(memory.mcpCache("art").call.text).toBe("cached");
			control.exec("DROP TRIGGER fail_cache_delete");
			memory.forget("art");
			expect(memory.get("art", "key")).toBeUndefined();
			expect(memory.listReadShared("art")).toEqual([]);
			expect(memory.mcpCache("art")).toEqual({});
			expect(memory.get("shared", "shared-key")).toBe("shared");
		} finally { control.close(); memory.close(); rmSync(dir, { recursive: true, force: true }); }
	});

	it("preserves NUL bytes in shared-read keys", () => {
		const m = new Memory(":memory:");
		m.set("shared", "shared\0key", "value");
		m.noteSharedRead("art", "shared\0key");
		expect(m.listReadShared("art").map((row) => row.key)).toEqual(["shared\0key"]);
		m.close();
	});

	it("converts legacy all-keys markers to the keys present when the database opens", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-memory-migration-"));
		try {
			const path = join(dir, "memory.sqlite");
			const old = new Memory(path);
			old.set("shared", "existing", 1);
			old.noteSharedRead("art", "*");
			old.close();
			const migrated = new Memory(path);
			expect(migrated.listReadShared("art").map((row) => row.key)).toEqual(["existing"]);
			migrated.set("shared", "added-later", 2);
			expect(migrated.listReadShared("art").map((row) => row.key)).toEqual(["existing"]);
			migrated.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
