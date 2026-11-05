import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertArtifactId, isValidId, slugify } from "../../shared/ids.ts";
import { artifactsDir } from "../../shared/paths.ts";
import type { ArtifactMeta } from "../../shared/protocol.ts";

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

/** Claim a free id for a new artifact (`slug`, `slug-2`, …) by creating its folder exclusively. */
async function claimId(title: string, root: string): Promise<string> {
	const base = slugify(title);
	await mkdir(root, { recursive: true });
	for (let n = 1; ; n++) {
		const id = n === 1 ? base : `${base.slice(0, 60)}-${n}`;
		try {
			await mkdir(join(root, id)); // fails if another writer took it first
			return id;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
		}
	}
}

async function writeAtomic(file: string, data: string) {
	const tmp = `${file}.${process.pid}.tmp`;
	await writeFile(tmp, data, "utf8");
	await rename(tmp, file);
}

export async function writeArtifact(
	input: WriteArtifactInput,
	root = artifactsDir(),
): Promise<{ meta: ArtifactMeta; created: boolean }> {
	const id = input.id ?? (await claimId(input.title, root));
	const paths = artifactPaths(id, root);
	const previous = await readMeta(id, root);
	const now = Date.now();
	const meta: ArtifactMeta = {
		id,
		title: input.title,
		description: input.description ?? previous?.description,
		cwd: input.cwd ?? previous?.cwd,
		sessionId: input.sessionId ?? previous?.sessionId,
		mcp: input.mcp ?? previous?.mcp,
		createdAt: previous?.createdAt ?? now,
		updatedAt: now,
	};
	await mkdir(paths.dir, { recursive: true });
	// Code before meta: the gallery lists artifacts by meta.json, so it never sees one without code.
	// The code is written in place (not renamed over): Vite's watcher must see a "change" to hot-reload.
	await writeFile(paths.entry, input.code, "utf8");
	await writeAtomic(paths.meta, `${JSON.stringify(meta, null, 2)}\n`);
	return { meta, created: !previous };
}

export async function readMeta(id: string, root = artifactsDir()): Promise<ArtifactMeta | undefined> {
	if (!isValidId(id)) return undefined;
	const file = join(root, id, "meta.json");
	if (!existsSync(file)) return undefined;
	try {
		return JSON.parse(await readFile(file, "utf8")) as ArtifactMeta;
	} catch {
		return undefined;
	}
}

/** All artifacts, most recently updated first. */
export async function listArtifacts(root = artifactsDir()): Promise<ArtifactMeta[]> {
	if (!existsSync(root)) return [];
	const entries = await readdir(root, { withFileTypes: true });
	const metas = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => readMeta(e.name, root)));
	return metas.filter((m): m is ArtifactMeta => !!m).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteArtifact(id: string, root = artifactsDir()): Promise<boolean> {
	const { dir } = artifactPaths(id, root);
	if (!existsSync(dir)) return false;
	await rm(dir, { recursive: true, force: true });
	return true;
}
