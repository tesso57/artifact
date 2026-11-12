import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { Memory } from "../../../viewer/server/memory.ts";
import { bundleArtifact, collectSnapshot, escapeInlineScript, renderHtml } from "../../../viewer/server/export.ts";

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
		expect(html).toContain(`content="default-src 'none'; script-src 'unsafe-inline'`);
		expect(html).toContain("<title>A &#60;b&#62;</title>");
		expect(html).toContain("<style>.a{}</style>");
		expect(html).toContain('<script type="module">mount()</script>');
		expect(html).toContain('window.__PI_ARTIFACT__ = JSON.parse(');
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
	it("preserves JSON properties named __proto__ in embedded memory", () => {
		const value = JSON.parse('{"__proto__":{"saved":true}}');
		const html = renderHtml({ title: "t", css: "", js: "", snapshot: { ...snapshot, memory: [{ scope: "x", key: "k", value, updatedAt: 0 }] } });
		const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
		const context = { window: {} as { __PI_ARTIFACT__?: { memory: { value: unknown }[] } } };
		runInNewContext(script, context);
		expect(JSON.stringify(context.window.__PI_ARTIFACT__!.memory[0].value)).toBe(JSON.stringify(value));
	});
});

describe("collectSnapshot", () => {
	it("gives exports distinct identities even in the same millisecond", () => {
		const clock = vi.spyOn(Date, "now").mockReturnValue(123);
		const memory = new Memory(":memory:");
		try {
			const first = collectSnapshot(memory, { id: "art", title: "Art" });
			const second = collectSnapshot(memory, { id: "art", title: "Art" });
			expect(first.exportedAt).toBe(second.exportedAt);
			expect(first.snapshotId).toBeTruthy();
			expect(first.snapshotId).not.toBe(second.snapshotId);
		} finally { memory.close(); clock.mockRestore(); }
	});
	it("does not parse unrelated shared values when collecting a snapshot", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-export-shared-"));
		const path = join(dir, "memory.sqlite");
		const m = new Memory(path);
		try {
			m.set("shared", "used\0key", "visible");
			m.set("shared", "unrelated", "unused");
			m.noteSharedRead("art", "used\0key");
			const raw = new DatabaseSync(path);
			try { raw.prepare("UPDATE memory SET value = ? WHERE scope = ? AND key = ?").run("invalid JSON", "shared", "unrelated"); }
			finally { raw.close(); }
			const snap = collectSnapshot(m, { id: "art", title: "Art" });
			expect(snap.memory.map(({ key, value }) => [key, value])).toEqual([["used\0key", "visible"]]);
		} finally {
			m.close();
			await rm(dir, { recursive: true, force: true });
		}
	});
	it("embeds the artifact's memory, only the shared keys it read, and its MCP cache", () => {
		const m = new Memory(":memory:");
		m.set("art", "notes", ["a"]);
		m.set("other", "secret", "nope");
		m.set("shared", "used", 1);
		m.set("shared", "unused", 2);
		m.noteSharedRead("art", "used");
		m.cacheMcp("art", "mcp__x__y {}", { isError: false, text: "ok", data: 1 });
		const snap = collectSnapshot(m, { id: "art", title: "Art", mcp: ["x.y"] });
		expect(snap.memory.map((e) => `${e.scope}/${e.key}`).sort()).toEqual(["art/notes", "shared/used"]);
		expect(Object.keys(snap.mcp)).toEqual(["mcp__x__y {}"]);
		m.noteSharedRead("art", "*");
		expect(collectSnapshot(m, { id: "art", title: "Art" }).memory.map((e) => e.key).sort()).toEqual(["notes", "unused", "used"]);
		m.close();
	});

	it("does not embed cached MCP results that are no longer allowed", () => {
		const m = new Memory(":memory:");
		m.cacheMcp("art", "mcp__x__allowed {}", { isError: false, text: "allowed" });
		m.cacheMcp("art", "mcp__x__revoked {}", { isError: false, text: "secret" });
		const snap = collectSnapshot(m, { id: "art", title: "Art", mcp: ["x.allowed"] });
		expect(Object.keys(snap.mcp)).toEqual(["mcp__x__allowed {}"]);
		expect(collectSnapshot(m, { id: "art", title: "Art", mcp: [] }).mcp).toEqual({});
		expect(collectSnapshot(m, { id: "art", title: "Art", mcp: ["mcp__*"] }).mcp).toEqual({});
		m.close();
	});
});

it.each(["shared.ts", "_shared/shared.ts", ".vite-cache/shared.js"])("refuses an external raw import through shared file %s", async (shared) => {
	const root = await mkdtemp(join(tmpdir(), "pi-export-shared-guard-"));
	const previous = process.env.PI_ARTIFACTS_DIR;
	try {
		const artifacts = join(root, "artifacts");
		const artifact = join(artifacts, "demo");
		await mkdir(artifact, { recursive: true });
		const outside = join(root, "secret.txt");
		await writeFile(outside, "PRIVATE_MARKER");
		await mkdir(dirname(join(artifacts, shared)), { recursive: true });
		await writeFile(join(artifacts, shared), `import secret from ${JSON.stringify(`${outside}?raw`)}; export { secret };`);
		const entry = join(artifact, "index.tsx");
		await writeFile(entry, `import { secret } from ${JSON.stringify(`../${shared}`)}; export default function Demo() { return <p>{secret}</p>; }`);
		process.env.PI_ARTIFACTS_DIR = artifacts;
		await expect(bundleArtifact(entry, [entry])).rejects.toThrow(/outside the allowed viewer roots/);
	} finally {
		if (previous === undefined) delete process.env.PI_ARTIFACTS_DIR;
		else process.env.PI_ARTIFACTS_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});

it("allows shared code within the artifact root", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-export-shared-safe-"));
	const previous = process.env.PI_ARTIFACTS_DIR;
	try {
		const artifacts = join(root, "artifacts");
		const artifact = join(artifacts, "demo");
		await mkdir(artifact, { recursive: true });
		await writeFile(join(artifacts, "shared.ts"), 'export const label = "SHARED_ALLOWED_MARKER";');
		const entry = join(artifact, "index.tsx");
		await writeFile(entry, 'import { label } from "../shared.ts"; export default function Demo() { return <p>{label}</p>; }');
		process.env.PI_ARTIFACTS_DIR = artifacts;
		expect((await bundleArtifact(entry, [entry])).js).toContain("SHARED_ALLOWED_MARKER");
	} finally {
		if (previous === undefined) delete process.env.PI_ARTIFACTS_DIR;
		else process.env.PI_ARTIFACTS_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});

it("refuses external CSS imports from a shared stylesheet at the artifact root", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-export-shared-css-"));
	const previous = process.env.PI_ARTIFACTS_DIR;
	try {
		const artifacts = join(root, "artifacts");
		const artifact = join(artifacts, "demo");
		await mkdir(artifact, { recursive: true });
		await writeFile(join(root, "secret.css"), ".secret { color: red; }");
		await writeFile(join(artifacts, "shared.css"), '@import "../secret.css";');
		const entry = join(artifact, "index.tsx");
		await writeFile(entry, 'import "../shared.css"; export default function Demo() { return <p>hello</p>; }');
		process.env.PI_ARTIFACTS_DIR = artifacts;
		await expect(bundleArtifact(entry, [entry])).rejects.toThrow(/outside the allowed viewer roots/);
	} finally {
		if (previous === undefined) delete process.env.PI_ARTIFACTS_DIR;
		else process.env.PI_ARTIFACTS_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});

it("refuses external imports through shared user-template code", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-export-template-shared-"));
	const previous = process.env.PI_ARTIFACTS_TEMPLATES;
	try {
		const templates = join(root, "templates");
		const template = join(templates, "demo");
		await mkdir(template, { recursive: true });
		const outside = join(root, "secret.txt");
		await writeFile(outside, "PRIVATE_MARKER");
		await writeFile(join(templates, "shared.ts"), `import secret from ${JSON.stringify(`${outside}?raw`)}; export { secret };`);
		const entry = join(template, "template.tsx");
		await writeFile(entry, 'import { secret } from "../shared.ts"; export default function Demo() { return <p>{secret}</p>; }');
		process.env.PI_ARTIFACTS_TEMPLATES = templates;
		await expect(bundleArtifact(entry, [entry])).rejects.toThrow(/outside the allowed viewer roots/);
	} finally {
		if (previous === undefined) delete process.env.PI_ARTIFACTS_TEMPLATES;
		else process.env.PI_ARTIFACTS_TEMPLATES = previous;
		await rm(root, { recursive: true, force: true });
	}
});

it("refuses to bundle a raw import through a symlink outside allowed roots", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-export-guard-"));
	const previous = process.env.PI_ARTIFACTS_DIR;
	try {
		const artifacts = join(root, "artifacts");
		const artifact = join(artifacts, "demo");
		await mkdir(artifact, { recursive: true });
		const outside = join(root, "secret.txt");
		await writeFile(outside, "PRIVATE_MARKER");
		try { await symlink(outside, join(artifact, "leak.txt"), "file"); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		const entry = join(artifact, "index.tsx");
		await writeFile(entry, 'import value from "./leak.txt?raw"; export default function Demo() { return <p>{value}</p>; }');
		process.env.PI_ARTIFACTS_DIR = artifacts;
		await expect(bundleArtifact(entry, [entry])).rejects.toThrow(/outside the allowed viewer roots[\s\S]*copy.*artifact.*relative/i);
	} finally {
		if (previous === undefined) delete process.env.PI_ARTIFACTS_DIR;
		else process.env.PI_ARTIFACTS_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});

it("refuses a denied filename even when it links to an allowed file", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-export-deny-"));
	const previous = process.env.PI_ARTIFACTS_DIR;
	try {
		const artifacts = join(root, "artifacts");
		const artifact = join(artifacts, "demo");
		await mkdir(artifact, { recursive: true });
		await writeFile(join(artifact, "safe.txt"), "not secret");
		try { await symlink(join(artifact, "safe.txt"), join(artifact, ".env"), "file"); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		const entry = join(artifact, "index.tsx");
		await writeFile(entry, 'import value from "./.env?raw"; export default function Demo() { return <p>{value}</p>; }');
		process.env.PI_ARTIFACTS_DIR = artifacts;
		await expect(bundleArtifact(entry, [entry])).rejects.toThrow(/outside the allowed viewer roots/);
	} finally {
		if (previous === undefined) delete process.env.PI_ARTIFACTS_DIR;
		else process.env.PI_ARTIFACTS_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});

it("refuses to inline a CSS asset linked outside allowed roots", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-export-css-"));
	const previous = process.env.PI_ARTIFACTS_DIR;
	try {
		const artifacts = join(root, "artifacts");
		const artifact = join(artifacts, "demo");
		await mkdir(artifact, { recursive: true });
		const outside = join(root, "secret.svg");
		await writeFile(outside, '<svg xmlns="http://www.w3.org/2000/svg"><text>PRIVATE_MARKER</text></svg>');
		try { await symlink(outside, join(artifact, "leak.svg"), "file"); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		await writeFile(join(artifact, "style.css"), '.demo { background-image: url("./leak.svg"); }');
		const entry = join(artifact, "index.tsx");
		await writeFile(entry, 'import "./style.css"; export default function Demo() { return <p className="demo">Demo</p>; }');
		process.env.PI_ARTIFACTS_DIR = artifacts;
		await expect(bundleArtifact(entry, [entry])).rejects.toThrow(/outside the allowed viewer roots/);
	} finally {
		if (previous === undefined) delete process.env.PI_ARTIFACTS_DIR;
		else process.env.PI_ARTIFACTS_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});
