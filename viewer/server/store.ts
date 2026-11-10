import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertArtifactId, isValidId, slugify } from "../../shared/ids.ts";
import { artifactsDir } from "../../shared/paths.ts";
import type { ArtifactMeta } from "../../shared/protocol.ts";
import { withPathLock } from "./path-lock.ts";
import { assertRealDirectory, readExistingFile, writeSourceFile } from "./safe-file.ts";

export function artifactPaths(id: string, root = artifactsDir()) {
	assertArtifactId(id);
	const dir = join(root, id);
	return { dir, entry: join(dir, "index.tsx"), meta: join(dir, "meta.json") };
}

export interface WriteArtifactInput {
	/** Replace this artifact. Omit to create a new one with an id derived from the title. */
	id?: string;
	title: string;
	description?: string;
	code: string;
	cwd?: string;
	sessionId?: string;
	mcp?: string[];
}

async function writeAtomic(file: string, data: string) {
	const tmp = `${file}.${process.pid}.tmp`;
	const handle = await open(tmp, "wx");
	try {
		try { await handle.writeFile(data, "utf8"); } finally { await handle.close(); }
		await rename(tmp, file);
	} catch (error) {
		try { await rm(tmp, { force: true }); }
		catch (cleanupError) { throw new AggregateError([error, cleanupError], `Could not remove temporary metadata ${tmp}`); }
		throw error;
	}
}

export async function writeArtifact(
	input: WriteArtifactInput,
	root = artifactsDir(),
	hooks?: { beforeWrite?: () => void; afterWrite?: (meta: ArtifactMeta) => Promise<void> },
): Promise<{ meta: ArtifactMeta; created: boolean }> {
	const writeLocked = async (id: string, onCommitted?: () => void) => {
		const paths = artifactPaths(id, root);
		hooks?.beforeWrite?.();
		const previous = await readMeta(id, root);
		const now = Date.now();
		const meta: ArtifactMeta = {
			id,
			instanceId: previous?.instanceId ?? randomUUID(),
			title: input.title,
			description: input.description ?? previous?.description,
			cwd: input.cwd ?? previous?.cwd,
			sessionId: input.sessionId ?? previous?.sessionId,
			mcp: input.mcp ?? previous?.mcp,
			createdAt: previous?.createdAt ?? now,
			updatedAt: previous ? Math.max(now, previous.updatedAt + 1) : now,
		};
		await mkdir(paths.dir, { recursive: true });
		await assertRealDirectory(paths.dir);
		if (!previous) {
			const present = async (path: string) => {
				try {
					const info = await lstat(path);
					if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link file: ${path}`);
					return true;
				}
				catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
			};
			if (await present(paths.meta) || await present(paths.entry)) {
				throw new Error(`Cannot write artifact "${id}": existing metadata is missing or invalid; preserve and repair its files first`);
			}
		}
		// Code before meta: the gallery lists artifacts by meta.json, so it never sees one without code.
		// The code is written in place (not renamed over): Vite's watcher must see a "change" to hot-reload.
		const oldCode = await readExistingFile(paths.entry);
		try {
			await writeSourceFile(paths.entry, input.code);
			await writeAtomic(paths.meta, `${JSON.stringify(meta, null, 2)}\n`);
		} catch (error) {
			try {
				if (oldCode === undefined) await rm(paths.entry, { force: true });
				else await writeSourceFile(paths.entry, oldCode);
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], `Could not restore artifact code at ${paths.entry}`);
			}
			throw error;
		}
		onCommitted?.();
		try { await hooks?.afterWrite?.(meta); }
		catch (error) { throw new Error(`Artifact "${id}" was saved, but a post-save check failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
		return { meta, created: !previous };
	};
	if (input.id !== undefined) {
		const { dir } = artifactPaths(input.id, root);
		return withPathLock(dir, () => writeLocked(input.id!));
	}
	await mkdir(root, { recursive: true });
	const base = slugify(input.title);
	for (let n = 1; ; n++) {
		const suffix = `-${n}`;
		const id = n === 1 ? base : `${base.slice(0, 64 - suffix.length)}${suffix}`;
		const { dir } = artifactPaths(id, root);
		const result = await withPathLock(dir, async () => {
			try {
				await mkdir(dir);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
				throw error;
			}
			let committed = false;
			try {
				return await writeLocked(id, () => { committed = true; });
			} catch (error) {
				if (!committed) {
					try {
						await rm(dir, { recursive: true, force: true });
					} catch (cleanupError) {
						throw new AggregateError([error, cleanupError], `Could not remove failed artifact directory ${dir}`);
					}
				}
				throw error;
			}
		});
		if (result) return result;
	}
}

export async function readMeta(id: string, root = artifactsDir()): Promise<ArtifactMeta | undefined> {
	if (!isValidId(id)) return undefined;
	const file = join(root, id, "meta.json");
	if (!existsSync(file)) return undefined;
	try {
		const data = await readExistingFile(file);
		if (!data) return undefined;
		const value: unknown = JSON.parse(data.toString("utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
		const meta = value as Record<string, unknown>;
		if (meta.id !== id || typeof meta.title !== "string" || typeof meta.createdAt !== "number" || !Number.isFinite(meta.createdAt) || typeof meta.updatedAt !== "number" || !Number.isFinite(meta.updatedAt)) return undefined;
		for (const field of ["description", "cwd", "sessionId", "instanceId"]) {
			if (meta[field] !== undefined && typeof meta[field] !== "string") return undefined;
		}
		if (meta.mcp !== undefined && (!Array.isArray(meta.mcp) || !meta.mcp.every((item) => typeof item === "string"))) return undefined;
		return meta as unknown as ArtifactMeta;
	} catch {
		return undefined;
	}
}

/** Metadata for an artifact that has a regular source file and can be opened. */
export async function readAvailableMeta(id: string, root = artifactsDir()): Promise<ArtifactMeta | undefined> {
	const paths = artifactPaths(id, root);
	try {
		await assertRealDirectory(paths.dir);
		if (!(await lstat(paths.entry)).isFile()) return undefined;
		return await readMeta(id, root);
	} catch { return undefined; }
}

/** All artifacts, most recently updated first. */
export async function listArtifacts(root = artifactsDir()): Promise<ArtifactMeta[]> {
	if (!existsSync(root)) return [];
	const entries = await readdir(root, { withFileTypes: true });
	const metas = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => readMeta(e.name, root)));
	return metas.filter((m): m is ArtifactMeta => !!m).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteArtifact(id: string, root = artifactsDir(), afterDelete?: (deleted: boolean) => void): Promise<boolean> {
	const { dir } = artifactPaths(id, root);
	return withPathLock(dir, async () => {
		const exists = existsSync(dir);
		if (exists) {
			await rm(dir, { recursive: true, force: true });
		}
		try { afterDelete?.(exists); }
		catch (error) {
			if (!exists) throw error;
			throw new Error(`Artifact "${id}" files were deleted, but cleanup failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
		return exists;
	});
}
