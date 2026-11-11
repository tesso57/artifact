import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import postcss from "postcss";
import valueParser from "postcss-value-parser";

type ResolveSafe = (specifier: string, importer: string, isImport: boolean) => Promise<string | undefined>;

/** Validate local CSS imports and URLs before Vite's CSS processor reads them. */
export async function validateCssReferences(code: string, file: string, resolveSafe: ResolveSafe, visited = new Set<string>(), depth = 0): Promise<void> {
	if (depth > 32) throw new Error(`CSS import nesting is too deep in ${file}`);
	if (visited.has(file)) return;
	visited.add(file);
	const references: { value: string; isImport: boolean }[] = [];
	const root = postcss.parse(code, { from: file });
	root.walkAtRules(/^import$/i, (rule) => {
		const first = valueParser(rule.params).nodes.find((node) => node.type !== "space" && node.type !== "comment");
		if (!first) throw new Error(`Cannot validate CSS @import in ${file}`);
		if (first.type === "string") references.push({ value: first.value, isImport: true });
		else if (first.type === "function" && first.value.toLowerCase() === "url") {
			const parts = first.nodes.filter((node) => node.type !== "space" && node.type !== "comment");
			if (parts.length !== 1 || !["string", "word"].includes(parts[0].type)) throw new Error(`Cannot validate CSS @import in ${file}`);
			references.push({ value: parts[0].value, isImport: true });
		} else throw new Error(`Cannot validate CSS @import in ${file}`);
	});
	root.walkDecls((declaration) => {
		valueParser(declaration.value).walk((node) => {
			if (node.type !== "function") return;
			if (node.value.toLowerCase() === "url") {
				const parts = node.nodes.filter((part) => part.type !== "space" && part.type !== "comment");
				if (parts.length === 0) return false;
				if (parts.length === 1 && parts[0].type === "function") return false;
				if (parts.length === 1 && ["string", "word"].includes(parts[0].type)) references.push({ value: parts[0].value, isImport: false });
				else throw new Error(`Cannot validate CSS url() in ${file}`);
				return false;
			}
			if (/^(?:-webkit-)?image-set$/i.test(node.value)) {
				for (const part of node.nodes) if (part.type === "string") references.push({ value: part.value, isImport: false });
			}
		});
	});
	for (const reference of references) {
		const value = reference.value.trim();
		if (!value || /^(?:https?:|blob:|\/\/|#)/i.test(value)) continue;
		if (/^data:/i.test(value)) {
			if (reference.isImport) {
				const comma = value.indexOf(",");
				if (comma < 0) throw new Error(`Invalid CSS data import in ${file}`);
				const encoded = value.slice(comma + 1);
				const inline = /;base64(?:;|,)/i.test(value.slice(0, comma + 1)) ? Buffer.from(encoded, "base64").toString("utf8") : decodeURIComponent(encoded);
				await validateCssReferences(inline, `${file}?inline-${depth}`, async () => { throw new Error("Local CSS references in data imports are not supported"); }, visited, depth + 1);
			}
			continue;
		}
		if (/^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error(`Unsupported CSS reference in ${file}`);
		const target = await resolveSafe(value, file, reference.isImport);
		if (!target) throw new Error(`Cannot safely resolve CSS reference ${JSON.stringify(value)} in ${file}`);
		if (reference.isImport) {
			if (extname(target).toLowerCase() !== ".css") throw new Error(`Unsupported CSS preprocessor import in ${file}`);
			await validateCssReferences(await readFile(target, "utf8"), target, resolveSafe, visited, depth + 1);
		}
	}
}
