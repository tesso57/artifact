import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeExportFile } from "../../../viewer/server/export-file.ts";

it("replaces an existing export only after the new content is ready", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-export-file-"));
	try {
		const file = join(dir, "report.html");
		await writeFile(file, "old");
		if (process.platform !== "win32") await chmod(file, 0o600);
		await expect(writeExportFile(file, "new", false)).rejects.toThrow(/exists/);
		expect(await readFile(file, "utf8")).toBe("old");
		await writeExportFile(file, "new", true);
		expect(await readFile(file, "utf8")).toBe("new");
		if (process.platform !== "win32") expect((await lstat(file)).mode & 0o077).toBe(0);
		expect(await readdir(dir)).toEqual(["report.html"]);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

it("replaces a destination symlink without modifying its target", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-export-file-"));
	try {
		const target = join(dir, "original.html");
		const link = join(dir, "report.html");
		await writeFile(target, "original");
		try { await symlink(target, link); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		await writeExportFile(link, "export", true);
		expect(await readFile(target, "utf8")).toBe("original");
		expect(await readFile(link, "utf8")).toBe("export");
	} finally { await rm(dir, { recursive: true, force: true }); }
});

it("removes the temporary file if replacement fails", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-export-file-"));
	try {
		const target = join(dir, "report.html");
		await mkdir(target);
		await expect(writeExportFile(target, "new", true)).rejects.toThrow();
		expect(await readdir(dir)).toEqual(["report.html"]);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
