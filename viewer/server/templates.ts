import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { userTemplatesDir } from "../../shared/paths.ts";
import { isValidId } from "../../shared/ids.ts";
import { withPathLock } from "./path-lock.ts";
import { assertRealDirectory, readExistingFile, writeSourceFile } from "./safe-file.ts";

/** What a template is for; `useCases` is what the agent matches requests against. */
interface TemplateMeta {
	title: string;
	description: string;
	useCases: string[];
	tags?: string[];
	/** MCP tools a preview of the template may call (same patterns as artifact_write). */
	mcp?: string[];
	/** Changes on every save so open previews can invalidate version-specific data. */
	revision?: string;
}

interface TemplateInfo extends TemplateMeta {
	name: string;
	source: "bundled" | "user";
	/** Absolute path of `template.tsx`. */
	path: string;
}

function parseTemplateMeta(value: unknown): TemplateMeta | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const meta = value as Record<string, unknown>;
	if (typeof meta.title !== "string" || typeof meta.description !== "string") return undefined;
	if (meta.revision !== undefined && typeof meta.revision !== "string") return undefined;
	const stringArray = (v: unknown) => Array.isArray(v) && v.every((item) => typeof item === "string");
	if ((meta.useCases !== undefined && !stringArray(meta.useCases)) || (meta.tags !== undefined && !stringArray(meta.tags)) || (meta.mcp !== undefined && !stringArray(meta.mcp))) return undefined;
	return { ...(meta as unknown as TemplateMeta), useCases: (meta.useCases as string[] | undefined) ?? [] };
}

function decodeTemplateMeta(data: string): TemplateMeta | undefined {
	try { return parseTemplateMeta(JSON.parse(data)); } catch { return undefined; }
}

function templateFiles(dir: string, name: string) {
	if (!isValidId(name)) throw new Error(`Invalid template name "${name}": use lowercase letters, digits and "-"`);
	return { dir: join(dir, name), code: join(dir, name, "template.tsx"), meta: join(dir, name, "template.json") };
}

async function readInfo(dir: string, name: string, source: TemplateInfo["source"]): Promise<TemplateInfo | undefined> {
	const files = templateFiles(dir, name);
	try {
		if (!(await lstat(files.dir)).isDirectory() || !(await lstat(files.code)).isFile()) return undefined;
		const data = await readExistingFile(files.meta);
		if (!data) return undefined;
		const meta = decodeTemplateMeta(data.toString("utf8"));
		return meta && { ...meta, name, source, path: files.code };
	} catch { return undefined; }
}

async function readDir(dir: string, source: TemplateInfo["source"]): Promise<TemplateInfo[]> {
	if (!existsSync(dir)) return [];
	const out: TemplateInfo[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (!entry.isDirectory() || !isValidId(entry.name)) continue;
		const info = await readInfo(dir, entry.name, source);
		if (info) out.push(info);
	}
	return out;
}

/** Bundled and user templates; a user template overrides a bundled one with the same name. */
export async function listTemplates(bundledDir: string, userDir = userTemplatesDir()): Promise<TemplateInfo[]> {
	const byName = new Map<string, TemplateInfo>();
	for (const t of [...(await readDir(bundledDir, "bundled")), ...(await readDir(userDir, "user"))]) byName.set(t.name, t);
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTemplate(
	name: string,
	bundledDir: string,
	userDir = userTemplatesDir(),
): Promise<(TemplateInfo & { code: string }) | undefined> {
	if (!isValidId(name)) return undefined;
	const info = await readInfo(userDir, name, "user") ?? await readInfo(bundledDir, name, "bundled");
	if (!info) return undefined;
	const code = await readExistingFile(info.path);
	return code && { ...info, code: code.toString("utf8") };
}

export async function saveTemplate(
	name: string,
	meta: TemplateMeta,
	code: string,
	userDir = userTemplatesDir(),
	afterWrite?: (info: TemplateInfo) => Promise<void>,
): Promise<TemplateInfo> {
	const files = templateFiles(userDir, name);
	const valid = parseTemplateMeta(meta);
	if (!valid) throw new Error("Invalid template metadata: title and description must be strings; useCases, tags and mcp must be arrays of strings");
	if (!valid.title.trim() || !valid.description.trim()) throw new Error("A template needs a title and a description");
	if (!valid.useCases.length) throw new Error("A template needs at least one use case (when should it be picked?)");
	if (typeof code !== "string") throw new Error("Template code must be a string");
	const clean: TemplateMeta = { title: valid.title.trim(), description: valid.description.trim(), useCases: valid.useCases, tags: valid.tags, mcp: valid.mcp, revision: randomUUID() };
	const json = `${JSON.stringify(clean, null, 2)}\n`;
	return withPathLock(files.dir, async () => {
		await mkdir(files.dir, { recursive: true });
		await assertRealDirectory(files.dir);
		const oldCode = await readExistingFile(files.code);
		const oldMeta = await readExistingFile(files.meta);
		if ((oldMeta && !decodeTemplateMeta(oldMeta.toString("utf8"))) || (!oldMeta && oldCode)) {
			throw new Error(`Cannot save template "${name}": existing metadata is missing or invalid; preserve and repair its files first`);
		}
		const temporary = `${files.meta}.${randomUUID()}.tmp`;
		let tempCreated = false;
		let codeStarted = false;
		try {
			await writeFile(temporary, json, { encoding: "utf8", flag: "wx" });
			tempCreated = true;
			codeStarted = true;
			await writeSourceFile(files.code, code);
			await rename(temporary, files.meta);
		} catch (error) {
			if (codeStarted) {
				try {
					if (oldCode === undefined) await rm(files.code, { force: true });
					else await writeSourceFile(files.code, oldCode);
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], `Could not restore template code at ${files.code}`);
				}
			}
			throw error;
		} finally {
			if (tempCreated) await rm(temporary, { force: true });
		}
		const info: TemplateInfo = { ...clean, name, source: "user", path: files.code };
		try { await afterWrite?.(info); }
		catch (error) { throw new Error(`Template "${name}" was saved, but a post-save check failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
		return info;
	});
}

/** Delete a user template (bundled templates are read-only). */
export async function deleteTemplate(name: string, userDir = userTemplatesDir(), afterDelete?: (deleted: boolean) => void): Promise<boolean> {
	const files = templateFiles(userDir, name);
	return withPathLock(files.dir, async () => {
		if (!existsSync(files.dir)) { afterDelete?.(false); return false; }
		await rm(files.dir, { recursive: true, force: true });
		try { afterDelete?.(true); }
		catch (error) { throw new Error(`Template "${name}" files were deleted, but cleanup failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
		return true;
	});
}
