import { describe, expect, it } from "vitest";
import { escapeInlineScript, renderHtml } from "../src/export/build.ts";

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
