import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { nodeTsFlags } from "../../../shared/node.ts";
import { writeExportFile } from "../../../viewer/server/export-file.ts";

it.skipIf(process.platform === "win32")("does not leave a partial new export after a write failure", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-export-full-"));
	const file = join(dir, "report.html");
	const module = pathToFileURL(resolve("viewer/server/export-file.ts")).href;
	const script = `import { writeExportFile } from ${JSON.stringify(module)}; try { await writeExportFile(${JSON.stringify(file)}, "x".repeat(100000), false); process.exitCode = 1; } catch (error) { if (error.code !== "EFBIG") throw error; }`;
	try {
		const child = spawnSync("sh", ["-c", 'trap "" XFSZ; ulimit -f 1; exec "$@"', "sh", process.execPath, ...nodeTsFlags(), "--input-type=module", "-e", script], { encoding: "utf8" });
		expect(child.status, child.stderr).toBe(0);
		expect(await readdir(dir)).toEqual([]);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

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

it("allows only one concurrent export to create a new destination", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-export-race-"));
	try {
		const file = join(dir, "report.html");
		const contents = ["a".repeat(65536), "b".repeat(65536)];
		const results = await Promise.allSettled(contents.map((html) => writeExportFile(file, html, false)));
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		const failures = results.filter((result) => result.status === "rejected");
		expect(failures).toHaveLength(1);
		expect((failures[0] as PromiseRejectedResult).reason.message).toMatch(/already exists/);
		expect(contents).toContain(await readFile(file, "utf8"));
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
