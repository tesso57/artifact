import { randomBytes } from "node:crypto";
import { lstat, open, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Replace an existing export only after its complete replacement has been written. */
export async function writeExportFile(file: string, html: string, overwrite: boolean): Promise<void> {
	if (!overwrite) {
		try { await writeFile(file, html, { encoding: "utf8", flag: "wx" }); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${file} already exists`);
			throw error;
		}
		return;
	}
	const existing = await lstat(file).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return undefined;
		throw error;
	});
	const mode = existing?.isFile() ? existing.mode & 0o777 : 0o666;
	const temporary = join(dirname(file), `.${basename(file)}.${randomBytes(12).toString("hex")}.tmp`);
	const handle = await open(temporary, "wx", mode);
	try {
		try { await handle.writeFile(html, "utf8"); } finally { await handle.close(); }
		await rename(temporary, file);
	} finally {
		await rm(temporary, { force: true });
	}
}
