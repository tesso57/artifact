import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";
import { RuntimeAliases } from "../../../viewer/server/runtime-aliases.ts";

it("maps special roots to private temporary aliases and removes only the aliases", () => {
	const root = mkdtempSync(join(tmpdir(), "pi root #%-"));
	const source = join(root, "file.txt");
	writeFileSync(source, "original");
	const aliases = new RuntimeAliases([root]);
	try {
		if (!aliases.paths.length) return; // Some Windows configurations disallow links.
		const mapped = aliases.map(source);
		const aliasRoot = aliases.paths[0];
		expect(mapped).not.toBe(source);
		expect(readFileSync(mapped, "utf8")).toBe("original");
		aliases.cleanup();
		expect(existsSync(aliasRoot)).toBe(false);
		expect(readFileSync(source, "utf8")).toBe("original");
	} finally {
		aliases.cleanup();
		rmSync(root, { recursive: true, force: true });
	}
});

it("aliases a safe-looking root whose real path contains URL delimiters", () => {
	const parent = mkdtempSync(join(tmpdir(), "pi-alias-link-"));
	const special = join(parent, "physical # %");
	const original = join(parent, "safe-name");
	mkdirSync(special);
	writeFileSync(join(special, "file.txt"), "content");
	try {
		try { symlinkSync(special, original, process.platform === "win32" ? "junction" : "dir"); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		const aliases = new RuntimeAliases([original]);
		try {
			expect(aliases.paths.length).toBe(1);
			expect(realpathSync(aliases.map(join(original, "file.txt")))).toBe(realpathSync(join(special, "file.txt")));
		} finally { aliases.cleanup(); }
	} finally { rmSync(parent, { recursive: true, force: true }); }
});

it("preserves relative paths between nested aliased roots", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-nested #%-"));
	const templates = join(root, ".templates");
	mkdirSync(join(templates, "example"), { recursive: true });
	mkdirSync(join(root, "artifact"));
	writeFileSync(join(root, "artifact", "helper.ts"), "export const value = 1;");
	const aliases = new RuntimeAliases([templates, root]);
	try {
		if (!aliases.paths.length) return;
		const template = aliases.map(join(templates, "example", "template.tsx"));
		const helper = aliases.map(join(root, "artifact", "helper.ts"));
		expect(resolve(dirname(template), "../../artifact/helper.ts")).toBe(helper);
	} finally {
		aliases.cleanup();
		expect(readFileSync(join(root, "artifact", "helper.ts"), "utf8")).toContain("value");
		rmSync(root, { recursive: true, force: true });
	}
});

it("selects the most specific real root even when its parent's symlink name is longer", () => {
	const parent = mkdtempSync(join(tmpdir(), "pi-specific-alias-"));
	const realRoot = join(parent, "root #");
	const child = join(realRoot, "child #");
	const longAlias = join(parent, "a".repeat(120));
	mkdirSync(child, { recursive: true });
	writeFileSync(join(child, "file.txt"), "content");
	try {
		try { symlinkSync(realRoot, longAlias, process.platform === "win32" ? "junction" : "dir"); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		const aliases = new RuntimeAliases([longAlias, child]);
		try {
			if (!aliases.paths.length) return;
			const mapped = aliases.map(realpathSync(join(child, "file.txt")));
			expect(mapped).not.toMatch(/[#?%]/);
			expect(readFileSync(mapped, "utf8")).toBe("content");
		} finally { aliases.cleanup(); }
	} finally { rmSync(parent, { recursive: true, force: true }); }
});
