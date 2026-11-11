import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolvePhysicalPath } from "../../shared/node.ts";
import { needsVirtualModule } from "./virtual-modules.ts";

function inside(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Private symlink aliases let Vite resolve files under roots containing URL delimiters. */
export class RuntimeAliases {
	private readonly entries: { original: string; real: string; alias: string }[] = [];
	private directory?: string;

	constructor(roots: string[]) {
		const unique = [...new Set(roots.map((root) => resolve(root)))].filter((root) => needsVirtualModule(root) || needsVirtualModule(resolvePhysicalPath(root)));
		if (!unique.length) return;
		const windowsTemp = process.env.SystemRoot ? join(process.env.SystemRoot, "Temp") : undefined;
		const parents = [...new Set([tmpdir(), ...(process.platform === "win32" ? (windowsTemp ? [windowsTemp] : []) : ["/tmp"])])];
		for (const parent of parents) {
			try { if (needsVirtualModule(parent) || needsVirtualModule(resolvePhysicalPath(parent))) continue; } catch { continue; }
			try { this.directory = mkdtempSync(join(parent, "pi-artifacts-alias-")); break; } catch {}
		}
		if (!this.directory) return;
		try {
			const roots = unique.map((original) => ({ original, real: realpathSync(original) })).sort((a, b) => a.real.length - b.real.length);
			for (const [index, { original, real }] of roots.entries()) {
				const parent = this.entries.find((entry) => inside(entry.real, real) && !needsVirtualModule(relative(entry.real, real)));
				const alias = parent ? join(parent.alias, relative(parent.real, real)) : join(this.directory, String(index));
				if (!parent) symlinkSync(real, alias, process.platform === "win32" ? "junction" : "dir");
				this.entries.push({ original, real, alias });
			}
		} catch {
			this.cleanup(); // Fall back to the existing single-file virtual module route.
		}
	}

	get paths(): string[] { return [...new Set(this.entries.map((entry) => entry.alias))]; }

	map(file: string): string {
		const path = resolve(file);
		let best: { alias: string; root: string } | undefined;
		for (const entry of this.entries) {
			for (const root of [entry.original, entry.real]) {
				if (inside(root, path) && (!best || root.length > best.root.length)) best = { alias: entry.alias, root };
			}
		}
		return best ? join(best.alias, relative(best.root, path)) : file;
	}

	cleanup(): void {
		if (this.directory) rmSync(this.directory, { recursive: true, force: true });
		this.directory = undefined;
		this.entries.length = 0;
	}
}
