import { describe, expect, it } from "vitest";
import { fsUrl } from "../../../shared/paths.ts";
import { compareVersions, mcpAllowed, mcpCallKey, normalizeMcpToolName, parseMcpToolName, stableStringify } from "../../../shared/protocol.ts";

describe("version comparison", () => {
	it("orders prereleases below releases and compares their identifiers", () => {
		expect(compareVersions("0.3.0-rc.1", "0.3.0")).toBeLessThan(0);
		expect(compareVersions("0.3.0", "0.3.0-rc.1")).toBeGreaterThan(0);
		expect(compareVersions("0.3.0-rc.10", "0.3.0-rc.2")).toBeGreaterThan(0);
		expect(compareVersions("0.3.0-1", "0.3.0-alpha")).toBeLessThan(0);
		expect(compareVersions("0.3.0-alpha", "0.3.0-alpha.1")).toBeLessThan(0);
		expect(compareVersions("0.3.0+build.2", "0.3.0+build.1")).toBe(0);
	});
});

describe("MCP names", () => {
	it("parses and normalizes", () => {
		expect(parseMcpToolName("mcp__github__search_issues")).toEqual({ server: "github", tool: "search_issues" });
		expect(parseMcpToolName("bash")).toBeUndefined();
		const cases: [[string, string?], string][] = [
			[["mcp__gh__search"], "mcp__gh__search"],
			[["gh.search"], "mcp__gh__search"],
			[["gh.search.v2"], "mcp__gh__search.v2"],
			[["gh", "search"], "mcp__gh__search"],
			[["bash"], "bash"],
		];
		for (const [args, expected] of cases) expect(normalizeMcpToolName(...args)).toBe(expected);
	});
});

describe("mcpAllowed", () => {
	it("matches exact names, server wildcards and *", () => {
		expect(mcpAllowed(["gh.search"], "mcp__gh__search")).toBe(true);
		expect(mcpAllowed(["mcp__gh__search"], "mcp__gh__search")).toBe(true);
		expect(mcpAllowed(["gh.search"], "mcp__gh__delete")).toBe(false);
		expect(mcpAllowed(["gh.*"], "mcp__gh__delete")).toBe(true);
		expect(mcpAllowed(["gh.*"], "mcp__ghx__delete")).toBe(false);
		expect(mcpAllowed(["*"], "mcp__any__tool")).toBe(false);
	});
	it("denies by default and never allows non-MCP tools", () => {
		expect(mcpAllowed(undefined, "mcp__gh__search")).toBe(false);
		expect(mcpAllowed([], "mcp__gh__search")).toBe(false);
		expect(mcpAllowed(["*"], "bash")).toBe(false);
	});

	it("rejects malformed wildcard patterns without granting all servers", () => {
		for (const pattern of ["mcp__*", "mcp____*", "mcp__gh*"]) {
			expect(mcpAllowed([pattern], "mcp__gh__delete")).toBe(false);
			expect(mcpAllowed([pattern], "mcp__other__read")).toBe(false);
		}
		expect(mcpAllowed(["mcp__gh__*"], "mcp__gh__delete")).toBe(true);
		expect(mcpAllowed(["mcp__gh__*"], "mcp__other__read")).toBe(false);
	});
});

describe("mcpCallKey", () => {
	it("ignores key order and undefined values", () => {
		expect(stableStringify({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
		expect(mcpCallKey("mcp__x__y", { q: 1, p: 2 })).toBe(mcpCallKey("mcp__x__y", { p: 2, q: 1 }));
		expect(mcpCallKey("mcp__x__y", undefined)).toBe("mcp__x__y {}");
	});

	it("uses the JSON representation actually sent to MCP", () => {
		const date = new Date("2026-11-01T00:00:00.000Z");
		expect(mcpCallKey("mcp__x__y", { date })).toBe(mcpCallKey("mcp__x__y", { date: date.toISOString() }));
		expect(mcpCallKey("mcp__x__y", { date })).not.toBe(mcpCallKey("mcp__x__y", { date: {} }));
		expect(stableStringify({ values: Array(1), ignored: () => {} })).toBe('{"values":[null]}');
		// A root Date serializes to a string, which the bridge treats as empty arguments.
		expect(mcpCallKey("mcp__x__y", date)).toBe(mcpCallKey("mcp__x__y", {}));
	});
});

describe("fsUrl", () => {
	it("builds POSIX /@fs URLs, also from Windows paths", () => {
		expect(fsUrl("/home/u/.pi/artifacts/x/index.tsx")).toBe("/@fs/home/u/.pi/artifacts/x/index.tsx");
		expect(fsUrl("C:\\Users\\u\\.pi\\artifacts\\x\\index.tsx")).toBe("/@fs/C:/Users/u/.pi/artifacts/x/index.tsx");
	});
	it("escapes URL-reserved characters without changing the path structure", () => {
		expect(fsUrl("/tmp/space #?%/日本語/index.tsx")).toBe("/@fs/tmp/space%20%23%3F%25/%E6%97%A5%E6%9C%AC%E8%AA%9E/index.tsx");
	});
});
