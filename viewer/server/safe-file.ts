import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname } from "node:path";

/** Artifact and template directories must not redirect writes through a symlink. */
export async function assertRealDirectory(dir: string): Promise<void> {
	const stat = await lstat(dir);
	if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link directory: ${dir}`);
	if (!stat.isDirectory()) throw new Error(`Not a directory: ${dir}`);
}

async function assertRegularOrMissing(file: string): Promise<void> {
	await assertRealDirectory(dirname(file));
	const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return undefined;
		throw error;
	});
	if (stat?.isSymbolicLink()) throw new Error(`Refusing symbolic link file: ${file}`);
	if (stat && !stat.isFile()) throw new Error(`Not a regular file: ${file}`);
}

/** Read an existing regular file without following a symlink at the final component. */
export async function readExistingFile(file: string): Promise<Buffer | undefined> {
	await assertRegularOrMissing(file);
	try {
		const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		try { return await handle.readFile(); } finally { await handle.close(); }
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

/** Write in place for Vite's watcher, while refusing symlinks at the final component. */
export async function writeSourceFile(file: string, data: string | Buffer): Promise<void> {
	await assertRegularOrMissing(file);
	const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
	const handle = await open(file, flags, 0o666);
	try { await handle.writeFile(data); } finally { await handle.close(); }
}
