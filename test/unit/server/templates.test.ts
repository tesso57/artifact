import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteTemplate, getTemplate, listTemplates, saveTemplate } from "../../../viewer/server/templates.ts";

let bundled: string;
let user: string;
const meta = { title: "T", description: "D", useCases: ["u"] };

beforeEach(async () => {
	const root = await mkdtemp(join(tmpdir(), "tpl-"));
	bundled = join(root, "bundled");
	user = join(root, "user");
	await mkdir(join(bundled, "dash"), { recursive: true });
	await writeFile(join(bundled, "dash", "template.tsx"), "// bundled");
	await writeFile(join(bundled, "dash", "template.json"), JSON.stringify({ ...meta, title: "Dash" }));
	await mkdir(join(bundled, "broken"), { recursive: true }); // no files: skipped
});
afterEach(async () => {
	await rm(join(bundled, ".."), { recursive: true, force: true });
});

describe("templates", () => {
	it("reports that the template was saved when its post-save check fails", async () => {
		await expect(saveTemplate("saved", meta, "source", user, async () => { throw new Error("check failed"); })).rejects.toThrow(/template "saved" was saved.*check failed/i);
		expect(await readFile(join(user, "saved", "template.tsx"), "utf8")).toBe("source");
	});
	it("lists bundled templates and skips incomplete folders", async () => {
		expect((await listTemplates(bundled, user)).map((t) => [t.name, t.source])).toEqual([["dash", "bundled"]]);
	});

	it("keeps an MCP allowlist for previews", async () => {
		const t = await saveTemplate("mcp-thing", { ...meta, mcp: ["gh.*"] }, "", user);
		expect(t.mcp).toEqual(["gh.*"]);
		expect((await getTemplate("mcp-thing", bundled, user))?.mcp).toEqual(["gh.*"]);
	});

	it("saves user templates that override bundled ones by name", async () => {
		await saveTemplate("kanban", meta, "// kanban", user);
		await saveTemplate("dash", { ...meta, title: "My dash" }, "// mine", user);
		const all = await listTemplates(bundled, user);
		expect(all.map((t) => `${t.name}:${t.source}`)).toEqual(["dash:user", "kanban:user"]);
		expect((await getTemplate("dash", bundled, user))?.code).toBe("// mine");
	});

	it("does not let invalid user metadata hide a valid bundled template", async () => {
		await mkdir(join(user, "dash"), { recursive: true });
		await writeFile(join(user, "dash", "template.tsx"), "// invalid user template");
		for (const invalid of [
			{ ...meta, title: 42 },
			{ ...meta, useCases: "not an array" },
			{ ...meta, mcp: [42] },
			{ ...meta, tags: [null] },
		]) {
			await writeFile(join(user, "dash", "template.json"), JSON.stringify(invalid));
			const template = await getTemplate("dash", bundled, user);
			expect(template).toMatchObject({ source: "bundled", title: "Dash", code: "// bundled" });
		}
	});

	it("does not read template code or metadata through symlinks", async () => {
		const dir = join(user, "dash");
		const outsideCode = join(bundled, "..", "outside.tsx");
		const outsideMeta = join(bundled, "..", "outside.json");
		await mkdir(dir, { recursive: true });
		await writeFile(outsideCode, "// private external source");
		await writeFile(outsideMeta, JSON.stringify({ ...meta, title: "Outside" }));
		try { await symlink(outsideCode, join(dir, "template.tsx")); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		await writeFile(join(dir, "template.json"), JSON.stringify(meta));
		expect(await getTemplate("dash", bundled, user)).toMatchObject({ source: "bundled", code: "// bundled" });
		await rm(join(dir, "template.tsx"));
		await rm(join(dir, "template.json"));
		await writeFile(join(dir, "template.tsx"), "// user");
		await symlink(outsideMeta, join(dir, "template.json"));
		expect(await getTemplate("dash", bundled, user)).toMatchObject({ source: "bundled", code: "// bundled" });
	});

	it("preserves an existing template if its metadata is invalid or missing", async () => {
		for (const name of ["brokenmeta", "nometa"]) {
			await mkdir(join(user, name), { recursive: true });
			await writeFile(join(user, name, "template.tsx"), "// preserve me");
		}
		await writeFile(join(user, "brokenmeta", "template.json"), '{"title":42}');
		for (const name of ["brokenmeta", "nometa"]) {
			await expect(saveTemplate(name, meta, "// replacement", user)).rejects.toThrow(/metadata/i);
			expect(await readFile(join(user, name, "template.tsx"), "utf8")).toBe("// preserve me");
		}
		expect(await readFile(join(user, "brokenmeta", "template.json"), "utf8")).toBe('{"title":42}');
	});

	it("keeps a template's code when saving its metadata fails", async () => {
		await saveTemplate("keep", { ...meta, title: "Original" }, "old code", user);
		const metadata = join(user, "keep", "template.json");
		await rm(metadata);
		await mkdir(metadata);
		await expect(saveTemplate("keep", { ...meta, title: "New" }, "new code", user)).rejects.toThrow();
		expect(await readFile(join(user, "keep", "template.tsx"), "utf8")).toBe("old code");
	});

	it("does not write through a symbolic-link template entry or directory", async () => {
		const victim = join(bundled, "..", "victim.txt");
		await writeFile(victim, "keep");
		await mkdir(join(user, "linked"), { recursive: true });
		try { await symlink(victim, join(user, "linked", "template.tsx"), "file"); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		await expect(saveTemplate("linked", meta, "overwrite", user)).rejects.toThrow(/symbolic link/i);
		expect(await readFile(victim, "utf8")).toBe("keep");
		const targetDir = join(bundled, "..", "victim-dir");
		await mkdir(targetDir);
		await writeFile(join(targetDir, "template.tsx"), "keep directory");
		await symlink(targetDir, join(user, "linked-dir"), process.platform === "win32" ? "junction" : "dir");
		await expect(saveTemplate("linked-dir", meta, "overwrite", user)).rejects.toThrow(/symbolic link/i);
		expect(await readFile(join(targetDir, "template.tsx"), "utf8")).toBe("keep directory");
	});

	it("keeps code and metadata paired under concurrent saves", async () => {
		await Promise.all(Array.from({ length: 20 }, (_, i) => saveTemplate("race", { ...meta, title: `version-${i}` }, `version-${i}`, user)));
		const saved = await getTemplate("race", bundled, user);
		expect(saved?.code).toBe(saved?.title);
	});

	it("validates names and metadata", async () => {
		await expect(saveTemplate("../x", meta, "", user)).rejects.toThrow(/Invalid template name/);
		await expect(saveTemplate("x", { ...meta, useCases: [] }, "", user)).rejects.toThrow(/use case/);
		await expect(saveTemplate("x", { ...meta, title: " " }, "", user)).rejects.toThrow(/title/);
	});

	it("rejects malformed metadata before replacing an existing template", async () => {
		await saveTemplate("safe", meta, "original", user);
		const metadataPath = join(user, "safe", "template.json");
		const original = await readFile(metadataPath, "utf8");
		for (const bad of [
			{ ...meta, useCases: "one" },
			{ ...meta, useCases: [42] },
			{ ...meta, tags: "tag" },
			{ ...meta, mcp: [42] },
		]) {
			await expect(saveTemplate("safe", bad as never, "replacement", user)).rejects.toThrow();
			expect(await readFile(join(user, "safe", "template.tsx"), "utf8")).toBe("original");
			expect(await readFile(metadataPath, "utf8")).toBe(original);
		}
		await expect(saveTemplate("safe", meta, {} as never, user)).rejects.toThrow(/code/i);
		expect(await readFile(join(user, "safe", "template.tsx"), "utf8")).toBe("original");
	});

	it("deletes only user templates", async () => {
		await saveTemplate("kanban", meta, "", user);
		expect(await deleteTemplate("kanban", user)).toBe(true);
		expect(await deleteTemplate("dash", user)).toBe(false);
		expect((await listTemplates(bundled, user)).map((t) => t.name)).toEqual(["dash"]);
	});

	it("reports when template files were deleted but preview cleanup failed", async () => {
		await saveTemplate("partial-delete", meta, "source", user);
		await expect(deleteTemplate("partial-delete", user, () => { throw new Error("database unavailable"); })).rejects.toThrow(/template "partial-delete" files were deleted.*cleanup failed.*database unavailable/i);
		await expect(readFile(join(user, "partial-delete", "template.tsx"))).rejects.toMatchObject({ code: "ENOENT" });
	});
});
