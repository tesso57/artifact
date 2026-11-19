import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { isFileLoadingAllowed, type Plugin, type ResolvedConfig } from "vite";
import { artifactsDir, BUNDLED_TEMPLATES_DIR, designDir, PACKAGE_ROOT, stateDir, userTemplatesDir } from "../../shared/paths.ts";
import { isValidId } from "../../shared/ids.ts";
import { ARTIFACTS_CHANGED_EVENT } from "../src/lib/events.ts";
import { apiMiddleware, guardMiddleware } from "./api.ts";
import type { DaemonContext } from "./context.ts";
import { parseVirtualModuleUrl } from "./virtual-modules.ts";
import { validateCssReferences } from "./css-guard.ts";

const SOURCE_PLACEHOLDER = '@source "PI_ARTIFACTS_SOURCES";';
const outsideRoots = (file: string) => new Error(`File is outside the allowed viewer roots: ${file}\nTo include intended content, copy it into the artifact directory and use a relative import. External symlink targets are also blocked; copied content can be visible in the viewer and exports.`);

export function piArtifactsPlugin({ sources, ctx, virtualSource }: { sources: string[]; ctx?: DaemonContext; virtualSource?: { id: string; file: string } }): Plugin {
	const virtualFiles = new Map<string, string>();
	if (virtualSource) virtualFiles.set(virtualSource.id, virtualSource.file);
	let policy: ResolvedConfig;
	let resolveCssImport: ReturnType<ResolvedConfig["createResolver"]>;
	let resolveCssUrl: ReturnType<ResolvedConfig["createResolver"]>;
	let sourceRoots: string[] = [];
	let artifactRoot = "";
	let packageRoot = "";
	let protectedState = "";
	let lastUpdate = 0;
	const inside = (root: string, file: string) => {
		const rel = relative(root, file);
		return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
	};
	const canonical = (file: string) => realpath(file).catch(() => resolve(file));
	const untrusted = async (id: string) => {
		const file = virtualFiles.get(id) ?? id.split("?")[0];
		if (!isAbsolute(file)) return false;
		const actual = await canonical(file);
		return sourceRoots.some((root) => inside(root, actual) &&
			(root !== artifactRoot ||
				!(packageRoot !== artifactRoot && inside(artifactRoot, packageRoot) && inside(packageRoot, actual))));
	};
	const checkPhysicalFile = async (path: string) => {
		const file = await canonical(path);
		if (inside(protectedState, file) || !isFileLoadingAllowed(policy, file.replaceAll("\\", "/"))) {
			throw outsideRoots(file);
		}
		return file;
	};
	const checkFile = async (id: string) => {
		const virtualFile = [...virtualFiles.values()].find((file) => id === file || id.startsWith(`${file}?`));
		return checkPhysicalFile(virtualFile ?? id.split("?")[0]);
	};
	const checkRequested = async (specifier: string, importer: string) => {
		if (!specifier.startsWith(".")) return;
		const importerFile = virtualFiles.get(importer.split("?")[0]) ?? importer.split("?")[0];
		if (!isAbsolute(importerFile)) return;
		const base = dirname(await canonical(importerFile));
		const path = specifier.split(/[?#]/, 1)[0];
		const candidates = [path];
		try { candidates.push(decodeURI(path)); } catch { throw new Error("Malformed artifact import path"); }
		for (const candidate of candidates) {
			const requested = resolve(base, candidate);
			if (inside(protectedState, requested) || !isFileLoadingAllowed(policy, requested.replaceAll("\\", "/"))) {
				throw outsideRoots(requested);
			}
		}
	};
	return {
		name: "pi-artifacts",
		enforce: "pre",
		async configResolved(config) {
			const allow = (await Promise.all(config.server.fs.allow.map(async (root) => [resolve(root), await canonical(root)]))).flat();
			policy = { ...config, safeModulePaths: new Set<string>(), server: { ...config.server, fs: { ...config.server.fs, strict: true, allow: allow.map((path) => path.replaceAll("\\", "/")) } } } as ResolvedConfig;
			resolveCssImport = config.createResolver({ extensions: [".css"], mainFields: ["style"], conditions: ["style", "development|production"], tryIndex: false, preferRelative: true });
			resolveCssUrl = config.createResolver({ preferRelative: true, tryIndex: false, extensions: [] });
			sourceRoots = await Promise.all([artifactsDir(), userTemplatesDir(), BUNDLED_TEMPLATES_DIR].map(canonical));
			artifactRoot = sourceRoots[0];
			packageRoot = await canonical(PACKAGE_ROOT);
			protectedState = await canonical(stateDir());
		},
		async resolveId(id, importer) {
			if (ctx && parseVirtualModuleUrl(id)) return id;
			if (!importer || !(await untrusted(importer))) return;
			if (id.startsWith("file:")) throw new Error("File URLs are not allowed in artifact imports");
			if (isAbsolute(id) && id.endsWith("?raw")) {
				const file = await realpath(id.slice(0, -4)).catch(() => undefined);
				if (file) await checkPhysicalFile(file);
			}
			await checkRequested(id, importer);
			const resolved = await this.resolve(id, importer, { skipSelf: true });
			if (resolved && !resolved.external && isAbsolute(resolved.id)) {
				await checkFile(resolved.id);
				if (/\.(?:scss|sass|less|sss)(?:\?|$)/i.test(resolved.id)) throw new Error("CSS preprocessors are not supported in artifact imports");
			}
			return resolved;
		},
		async load(id) {
			if (!ctx) return;
			const virtual = parseVirtualModuleUrl(id);
			const client = this.environment.config.consumer === "client";
			if (!client && !virtual) return;
			let file = id;
			if (virtual) {
				file = await ctx.moduleFile(id);
				virtualFiles.set(id, file);
				this.addWatchFile(file);
			}
			if (!client) return readFile(file, "utf8");
			let name = virtual?.kind === "a" ? virtual.name : undefined;
			if (!virtual && basename(file) === "index.tsx") {
				const parent = dirname(dirname(file));
				const candidate = basename(dirname(file));
				if (isValidId(candidate) && [resolve(artifactsDir()), resolve(ctx.aliases.map(artifactsDir())), sourceRoots[0]].includes(resolve(parent))) name = candidate;
			}
			const source = name && await ctx.loadObservableSource(name, async () => {
				const physical = await checkPhysicalFile(file);
				if (!virtual) this.addWatchFile(file);
				return readFile(physical, "utf8");
			});
			if (!source) return virtual ? readFile(file, "utf8") : undefined;
			if (!source.token) return source.code;
			const register = `__piObserve_${source.token.replaceAll("-", "")}`;
			const prelude = `import { registerRuntimeObservation as ${register} } from "/src/lib/runtime-observation.ts"; ${register}(import.meta.url, ${JSON.stringify(source.token)});\n`;
			const start = source.code.startsWith("#!") ? source.code.indexOf("\n") + 1 : 0;
			if (source.code.startsWith("#!") && !start) return `${source.code}\n${prelude}`;
			return source.code.slice(0, start) + prelude + source.code.slice(start);
		},
		async handleHotUpdate(update) {
			if (!ctx || !virtualFiles.size) return;
			const file = await realpath(update.file).catch(() => update.file);
			const graph = update.server.environments.client.moduleGraph;
			const timestamp = lastUpdate = Math.max(Date.now(), lastUpdate + 1);
			const updates: { type: "js-update"; path: string; acceptedPath: string; timestamp: number }[] = [];
			for (const [id, watched] of virtualFiles) {
				if (watched !== file) continue;
				const module = graph.getModuleById(id);
				if (!module) continue;
				graph.invalidateModule(module);
				updates.push({ type: "js-update", path: id, acceptedPath: id, timestamp });
			}
			if (updates.length) {
				update.server.ws.send({ type: "update", updates });
				return update.modules;
			}
		},
		async transform(code, id) {
			if (/\.css(?:\?|$)/i.test(id) && await untrusted(id)) {
				const file = id.split("?")[0];
				await checkFile(file);
				await validateCssReferences(code, file, async (specifier, importer, isImport) => {
					const decoded = isImport ? specifier : decodeURI(specifier).split("#")[0];
					const relativeSpecifier = !decoded.startsWith(".") && !decoded.startsWith("/") ? `./${decoded}` : decoded;
					await checkRequested(relativeSpecifier, importer);
					const resolved = await (isImport ? resolveCssImport : resolveCssUrl)(decoded, importer);
					if (!resolved || !isAbsolute(resolved)) return undefined;
					await checkFile(resolved);
					return resolved.split("?")[0];
				});
			}
			if (!id.split("?")[0].endsWith("/src/styles.css") || !code.includes(SOURCE_PLACEHOLDER)) return;
			const lines = sources.map((s) => `@source ${JSON.stringify(s.replaceAll("\\", "/"))};`).join("\n");
			return code.replace(SOURCE_PLACEHOLDER, lines);
		},
		configureServer(server) {
			if (!ctx) return;
			ctx.server = server;
			server.middlewares.use(guardMiddleware(ctx));
			server.middlewares.use((req, res, next) => {
				if (!req.url?.startsWith("/@fs/")) return next();
				let file: string;
				try {
					file = decodeURIComponent(new URL(req.url, ctx.origin).pathname.slice(4)).replace(/^\/([A-Za-z]:)/, "$1");
				} catch { return next(); }
				if (!isFileLoadingAllowed(policy, file.replaceAll("\\", "/"))) {
					res.statusCode = 403;
					return res.end("Forbidden");
				}
				void checkPhysicalFile(file).then(() => next(), () => { res.statusCode = 403; res.end("Forbidden"); });
			});
			server.middlewares.use(apiMiddleware(ctx));

			const dir = artifactsDir();
			const themeFile = join(designDir(), "theme.css");
			server.watcher.add([dir, themeFile]);
			const notify = (file: string) => {
				if (file === themeFile) return server.ws.send({ type: "full-reload" });
				const rel = relative(dir, file);
				if (rel.startsWith("..") || basename(file) !== "meta.json") return;
				server.ws.send({ type: "custom", event: ARTIFACTS_CHANGED_EVENT, data: { id: dirname(rel).split(sep)[0] } });
			};
			server.watcher.on("add", notify);
			server.watcher.on("change", notify);
			server.watcher.on("unlink", notify);
		},
	};
}
