import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { artifactsDir } from "./paths.ts";

export interface ArtifactMeta {
	id: string;
	title: string;
	description?: string;
	/** Working directory of the pi session that wrote it. */
	cwd?: string;
	createdAt: number;
	updatedAt: number;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Turn a title into a URL-safe artifact id. */
export function slugify(input: string): string {
	const slug = input
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
		.replace(/-+$/g, "");
	return slug || `artifact-${Date.now().toString(36)}`;
}

/** Artifact ids (and memory scopes): lowercase slug, max 64 chars. */
export function isValidId(id: string): boolean {
	return ID_RE.test(id);
}

export function assertValidId(id: string): void {
	if (!isValidId(id)) {
		throw new Error(`Invalid artifact id "${id}": use lowercase letters, digits and "-" (max 64 chars)`);
	}
}

export function artifactPaths(id: string, root = artifactsDir()) {
	assertValidId(id);
	const dir = join(root, id);
	return { dir, entry: join(dir, "index.tsx"), meta: join(dir, "meta.json") };
}

export interface WriteArtifactInput {
	id?: string;
	title: string;
	description?: string;
	code: string;
	cwd?: string;
}

export async function writeArtifact(input: WriteArtifactInput, root = artifactsDir()): Promise<ArtifactMeta> {
	const id = input.id ?? slugify(input.title);
	const paths = artifactPaths(id, root);
	const previous = await readMeta(id, root);
	const now = Date.now();
	const meta: ArtifactMeta = {
		id,
		title: input.title,
		description: input.description ?? previous?.description,
		cwd: input.cwd ?? previous?.cwd,
		createdAt: previous?.createdAt ?? now,
		updatedAt: now,
	};
	await mkdir(paths.dir, { recursive: true });
	// Write code before meta: the viewer lists artifacts by meta.json, so it never sees one without code.
	await writeFile(paths.entry, input.code, "utf8");
	await writeFile(paths.meta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
	return meta;
}

export async function readMeta(id: string, root = artifactsDir()): Promise<ArtifactMeta | undefined> {
	const { meta } = artifactPaths(id, root);
	if (!existsSync(meta)) return undefined;
	return JSON.parse(await readFile(meta, "utf8")) as ArtifactMeta;
}

export async function readCode(id: string, root = artifactsDir()): Promise<string | undefined> {
	const { entry } = artifactPaths(id, root);
	if (!existsSync(entry)) return undefined;
	return readFile(entry, "utf8");
}

/** All artifacts, most recently updated first. */
export async function listArtifacts(root = artifactsDir()): Promise<ArtifactMeta[]> {
	if (!existsSync(root)) return [];
	const entries = await readdir(root, { withFileTypes: true });
	const metas = await Promise.all(
		entries
			.filter((e) => e.isDirectory() && isValidId(e.name))
			.map((e) => readMeta(e.name, root).catch(() => undefined)),
	);
	return metas.filter((m): m is ArtifactMeta => !!m).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteArtifact(id: string, root = artifactsDir()): Promise<boolean> {
	const { dir } = artifactPaths(id, root);
	if (!existsSync(dir)) return false;
	await rm(dir, { recursive: true, force: true });
	return true;
}

/** URL path the viewer's browser imports an artifact module from (Vite serves and transforms it). */
export function artifactModuleUrl(id: string, viewerDir: string, root = artifactsDir()): string {
	const { entry } = artifactPaths(id, root);
	const rel = relative(viewerDir, entry);
	return rel.startsWith("..") ? `/@fs${entry}` : `/${rel.split(sep).join("/")}`;
}
