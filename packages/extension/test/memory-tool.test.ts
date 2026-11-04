import { Memory } from "@pi-artifacts/core";
import { describe, expect, it } from "vitest";
import { runMemoryAction } from "../src/tools/artifact-memory.ts";
import { formatWriteResult } from "../src/tools/artifact-write.ts";

describe("runMemoryAction", () => {
	it("sets, gets, lists and deletes", () => {
		const m = new Memory(":memory:");
		expect(runMemoryAction(m, { action: "set", scope: "a", key: "k", value: [1] })).toEqual({ ok: true });
		expect(runMemoryAction(m, { action: "get", scope: "a", key: "k" })).toEqual([1]);
		expect(runMemoryAction(m, { action: "get", scope: "a", key: "nope" })).toBeNull();
		expect(runMemoryAction(m, { action: "list", scope: "a" })).toEqual([{ key: "k", value: [1] }]);
		expect(runMemoryAction(m, { action: "delete", scope: "a", key: "k" })).toEqual({ deleted: true });
		m.close();
	});
	it("requires a key for get/set/delete", () => {
		const m = new Memory(":memory:");
		expect(() => runMemoryAction(m, { action: "get", scope: "a" })).toThrow(/key/);
		m.close();
	});
});

describe("formatWriteResult", () => {
	it("includes the URL, or the compile error for the agent to fix", () => {
		const base = { id: "x", title: "X", path: "/p/x/index.tsx", created: true };
		expect(formatWriteResult({ ...base, url: "http://h/a/x" })).toContain("URL: http://h/a/x");
		const err = formatWriteResult({ ...base, url: "http://h/a/x", compileError: "Unexpected token" });
		expect(err).toMatch(/Compile error[\s\S]*Unexpected token/);
	});
});
