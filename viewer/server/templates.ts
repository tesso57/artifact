import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { userTemplatesDir } from "../../shared/paths.ts";
import { isValidId } from "../../shared/ids.ts";

/** What a template is for; `useCases` is what the agent matches requests against. */
interface TemplateMeta {
	title: string;
	description: string;
	useCases: string[];
	tags?: string[];
	/** MCP tools a preview of the template may call (same patterns as artifact_write). */
	mcp?: string[];
}

interface TemplateInfo extends TemplateMeta {
	name: string;
	source: "bundled" | "user";
	/** Absolute path of `template.tsx`. */
	path: string;
}

function templateFiles(dir: string, name: string) {
	if (!isValidId(name)) throw new Error(`Invalid template name "${name}": use lowercase letters, digits and "-"`);
	return { dir: join(dir, name), code: join(dir, name, "template.tsx"), meta: join(dir, name, "template.json") };
}

async function readDir(dir: string, source: TemplateInfo["source"]): Promise<TemplateInfo[]> {
	if (!existsSync(dir)) return [];
	const out: TemplateInfo[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (!entry.isDirectory() || !isValidId(entry.name)) continue;
		const files = templateFiles(dir, entry.name);
		if (!existsSync(files.code) || !existsSync(files.meta)) continue;
		try {
			const meta = JSON.parse(await readFile(files.meta, "utf8")) as TemplateMeta;
			out.push({ ...meta, useCases: meta.useCases ?? [], name: entry.name, source, path: files.code });
		} catch {}
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
	const info = (await listTemplates(bundledDir, userDir)).find((t) => t.name === name);
	return info && { ...info, code: await readFile(info.path, "utf8") };
}

export async function saveTemplate(
	name: string,
	meta: TemplateMeta,
	code: string,
	userDir = userTemplatesDir(),
): Promise<TemplateInfo> {
	const files = templateFiles(userDir, name);
	if (!meta.title?.trim() || !meta.description?.trim()) throw new Error("A template needs a title and a description");
	if (!meta.useCases?.length) throw new Error("A template needs at least one use case (when should it be picked?)");
	await mkdir(files.dir, { recursive: true });
	await writeFile(files.code, code, "utf8");
	const clean: TemplateMeta = { title: meta.title.trim(), description: meta.description.trim(), useCases: meta.useCases, tags: meta.tags, mcp: meta.mcp };
	await writeFile(files.meta, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
	return { ...clean, name, source: "user", path: files.code };
}

/** Delete a user template (bundled templates are read-only). */
export async function deleteTemplate(name: string, userDir = userTemplatesDir()): Promise<boolean> {
	const files = templateFiles(userDir, name);
	if (!existsSync(files.dir)) return false;
	await rm(files.dir, { recursive: true, force: true });
	return true;
}
