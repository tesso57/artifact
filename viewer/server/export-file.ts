import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, lstat, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function writeExportFile(file: string, html: string, overwrite: boolean): Promise<void> {
	const existing = overwrite ? await lstat(file).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return undefined;
		throw error;
	}) : undefined;
	const mode = existing?.isFile() ? existing.mode & 0o777 : 0o666;
	const temporary = join(dirname(file), `.${basename(file)}.${randomBytes(12).toString("hex")}.tmp`);
	const handle = await open(temporary, "wx", mode);
	try {
		try { await handle.writeFile(html, "utf8"); } finally { await handle.close(); }
		if (overwrite) await rename(temporary, file);
		else {
			try { await link(temporary, file); }
			catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === "EEXIST") throw new Error(`${file} already exists`);
				if (!["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM"].includes(code ?? "")) throw error;
				try { await copyFile(temporary, file, constants.COPYFILE_EXCL); }
				catch (copyError) {
					if ((copyError as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${file} already exists`);
					throw copyError;
				}
			}
		}
	} finally {
		await rm(temporary, { force: true });
	}
}
