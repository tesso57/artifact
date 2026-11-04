import { describe, expect, it } from "vitest";
import { Memory } from "../src/memory.ts";
import { normalizeMcpToolName, parseMcpToolName } from "../src/bridge.ts";

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

	it("upserts, lists by prefix, deletes and clears", () => {
		const m = new Memory(":memory:");
		m.set("s", "user:1", "ann");
		m.set("s", "user:2", "bob");
		m.set("s", "other", true);
		m.set("s", "user:1", "ann2");
		expect(m.list("s", "user:").map((e) => [e.key, e.value])).toEqual([
			["user:1", "ann2"],
			["user:2", "bob"],
		]);
		expect(m.delete("s", "other")).toBe(true);
		expect(m.delete("s", "other")).toBe(false);
		expect(m.clear("s")).toBe(2);
		expect(m.list("s")).toEqual([]);
		m.close();
	});

	it("treats setting undefined as delete", () => {
		const m = new Memory(":memory:");
		m.set("s", "k", 1);
		m.set("s", "k", undefined);
		expect(m.get("s", "k")).toBeUndefined();
		m.close();
	});

	it("does not treat LIKE wildcards in prefixes specially", () => {
		const m = new Memory(":memory:");
		m.set("s", "a_b", 1);
		m.set("s", "axb", 2);
		expect(m.list("s", "a_").map((e) => e.key)).toEqual(["a_b"]);
		m.close();
	});
});

describe("parseMcpToolName", () => {
	it("splits server and tool", () => {
		expect(parseMcpToolName("mcp__github__search_issues")).toEqual({ server: "github", tool: "search_issues" });
		expect(parseMcpToolName("bash")).toBeUndefined();
	});
});

describe("normalizeMcpToolName", () => {
	const cases: [[string, string?], string][] = [
		[["mcp__gh__search"], "mcp__gh__search"],
		[["gh.search"], "mcp__gh__search"],
		[["gh.search.v2"], "mcp__gh__search.v2"],
		[["gh", "search"], "mcp__gh__search"],
		[["bash"], "bash"],
	];
	it.each(cases)("%j → %s", (args, expected) => {
		expect(normalizeMcpToolName(...args)).toBe(expected);
	});
});
