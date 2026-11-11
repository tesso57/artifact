import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { expect, it } from "vitest";
import { validateCssReferences } from "../../../viewer/server/css-guard.ts";

it("allows local nested styles and rejects links outside the allowed root", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-css-guard-"));
	try {
		const root = join(dir, "allowed");
		await mkdir(root);
		const entry = join(root, "style.css");
		await writeFile(join(root, "safe.css"), ".safe { color: red }");
		await writeFile(join(dir, "secret.css"), ":root { --secret: 1 }");
		const resolveSafe = async (specifier: string, importer: string) => {
			const target = await realpath(resolve(dirname(importer), specifier));
			const rel = relative(await realpath(root), target);
			if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("CSS file outside allowed roots");
			return target;
		};
		await expect(validateCssReferences('@import "./safe.css";', entry, resolveSafe)).resolves.toBeUndefined();
		try { await symlink(join(dir, "secret.css"), join(root, "link.css"), "file"); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		await writeFile(join(root, "safe.css"), '@import "./link.css";');
		await expect(validateCssReferences('@import "./safe.css";', entry, resolveSafe)).rejects.toThrow(/outside allowed roots/);
		await expect(validateCssReferences('.x { background: url("./link.css") }', entry, resolveSafe)).rejects.toThrow(/outside allowed roots/);
		await expect(validateCssReferences('.x { background: image-set("./link.css" 1x) }', entry, resolveSafe)).rejects.toThrow(/outside allowed roots/);
		const inline = Buffer.from('.x { background: url("./link.css") }').toString("base64");
		await expect(validateCssReferences(`@import "data:text/css;base64,${inline}";`, entry, resolveSafe)).rejects.toThrow(/data imports/);
		expect(await readFile(join(dir, "secret.css"), "utf8")).toContain("--secret");
	} finally { await rm(dir, { recursive: true, force: true }); }
});
