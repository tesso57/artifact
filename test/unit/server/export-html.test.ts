import { describe, expect, it } from "vitest";
import { Memory } from "../../../viewer/server/memory.ts";
import { collectSnapshot, escapeInlineScript, renderHtml } from "../../../viewer/server/export.ts";

const snapshot = { artifact: { id: "x", title: "X" }, exportedAt: 1, memory: [], mcp: {} };

describe("escapeInlineScript", () => {
	it("neutralises closing script tags and HTML comments", () => {
		expect(escapeInlineScript('a("</script>")<!--')).toBe('a("<\\/script>")<\\!--');
		expect(escapeInlineScript("</SCRIPT>")).toBe("<\\/SCRIPT>");
	});
});

describe("renderHtml", () => {
	it("inlines CSS, JS and the snapshot in one document", () => {
		const html = renderHtml({ title: "A <b>", css: ".a{}", js: "mount()", snapshot });
		expect(html).toMatch(/^<!doctype html>/);
		expect(html).toContain("<title>A &#60;b&#62;</title>");
		expect(html).toContain("<style>.a{}</style>");
		expect(html).toContain('<script type="module">mount()</script>');
		expect(html).toContain('window.__PI_ARTIFACT__ = {"artifact":{"id":"x"');
	});
	it("cannot be broken out of via memory values", () => {
		const evil = {
			...snapshot,
			memory: [{ scope: "x", key: "k", value: "</script><script>alert(1)</script>", updatedAt: 0 }],
		};
		const html = renderHtml({ title: "t", css: "", js: "", snapshot: evil });
		expect(html).not.toContain("<script>alert(1)");
		expect(html.match(/<\/script>/g)?.length).toBe(2);
	});
});

describe("collectSnapshot", () => {
	it("embeds the artifact's memory, only the shared keys it read, and its MCP cache", () => {
		const m = new Memory(":memory:");
		m.set("art", "notes", ["a"]);
		m.set("other", "secret", "nope");
		m.set("shared", "used", 1);
		m.set("shared", "unused", 2);
		m.noteSharedRead("art", "used");
		m.cacheMcp("art", "mcp__x__y {}", { isError: false, text: "ok", data: 1 });
		const snap = collectSnapshot(m, { id: "art", title: "Art" });
		expect(snap.memory.map((e) => `${e.scope}/${e.key}`).sort()).toEqual(["art/notes", "shared/used"]);
		expect(Object.keys(snap.mcp)).toEqual(["mcp__x__y {}"]);
		m.noteSharedRead("art", "*");
		expect(collectSnapshot(m, { id: "art", title: "Art" }).memory.map((e) => e.key).sort()).toEqual(["notes", "unused", "used"]);
		m.close();
	});
});
