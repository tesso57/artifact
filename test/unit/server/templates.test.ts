import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

	it("validates names and metadata", async () => {
		await expect(saveTemplate("../x", meta, "", user)).rejects.toThrow(/Invalid template name/);
		await expect(saveTemplate("x", { ...meta, useCases: [] }, "", user)).rejects.toThrow(/use case/);
		await expect(saveTemplate("x", { ...meta, title: " " }, "", user)).rejects.toThrow(/title/);
	});

	it("deletes only user templates", async () => {
		await saveTemplate("kanban", meta, "", user);
		expect(await deleteTemplate("kanban", user)).toBe(true);
		expect(await deleteTemplate("dash", user)).toBe(false);
		expect((await listTemplates(bundled, user)).map((t) => t.name)).toEqual(["dash"]);
	});
});
