import { isValidId } from "../../shared/ids.ts";

type ModuleKind = "a" | "t";

/** Vite treats these characters as URL syntax in physical module IDs. */
export function needsVirtualModule(file: string): boolean {
	return /[#?%]/.test(file);
}

export function virtualModuleUrl(kind: ModuleKind, name: string): string {
	if (!isValidId(name)) throw new Error(`Invalid module name ${JSON.stringify(name)}`);
	return `/__pi_virtual__/${kind}/${name}/${kind === "a" ? "index" : "template"}.tsx`;
}

export function parseVirtualModuleUrl(url: string): { kind: ModuleKind; name: string } | undefined {
	const match = /^\/__pi_virtual__\/(a|t)\/([a-z0-9][a-z0-9-]{0,63})\/(index|template)\.tsx$/.exec(url);
	if (!match || (match[1] === "a" ? match[3] !== "index" : match[3] !== "template")) return undefined;
	return { kind: match[1] as ModuleKind, name: match[2] };
}
