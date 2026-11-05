import { describe, expect, it } from "vitest";
import { fsUrl } from "../../../shared/paths.ts";
import { mcpAllowed, mcpCallKey, normalizeMcpToolName, parseMcpToolName, stableStringify } from "../../../shared/protocol.ts";

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
		expect(mcpAllowed(["*"], "mcp__any__tool")).toBe(true);
	});
	it("denies by default and never allows non-MCP tools", () => {
		expect(mcpAllowed(undefined, "mcp__gh__search")).toBe(false);
		expect(mcpAllowed([], "mcp__gh__search")).toBe(false);
		expect(mcpAllowed(["*"], "bash")).toBe(false);
	});
});

describe("mcpCallKey", () => {
	it("ignores key order and undefined values", () => {
		expect(stableStringify({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
		expect(mcpCallKey("mcp__x__y", { q: 1, p: 2 })).toBe(mcpCallKey("mcp__x__y", { p: 2, q: 1 }));
		expect(mcpCallKey("mcp__x__y", undefined)).toBe("mcp__x__y {}");
	});
});

describe("fsUrl", () => {
	it("builds POSIX /@fs URLs, also from Windows paths", () => {
		expect(fsUrl("/home/u/.pi/artifacts/x/index.tsx")).toBe("/@fs/home/u/.pi/artifacts/x/index.tsx");
		expect(fsUrl("C:\\Users\\u\\.pi\\artifacts\\x\\index.tsx")).toBe("/@fs/C:/Users/u/.pi/artifacts/x/index.tsx");
	});
});
