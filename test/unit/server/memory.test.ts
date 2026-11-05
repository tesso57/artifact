import { describe, expect, it } from "vitest";
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
		expect(m.sharedReads("art")).toEqual(["theme"]);
		m.forget("art");
		expect(m.list("art")).toEqual([]);
		expect(m.mcpCache("art")).toEqual({});
		expect(m.sharedReads("art")).toEqual([]);
		expect(m.get("shared", "theme")).toBe("dark");
		m.close();
	});
});
