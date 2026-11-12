/**
 * The daemon's state and operations, shared by its HTTP API (pi extension), the server
 * functions (browser) and the exporter. One instance per daemon process, reachable from
 * server functions through `globalThis` (they run in Vite's module runner).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import type { ViteDevServer } from "vite";
import { assertArtifactId, assertMemoryScope, isValidId, isValidRuntimeId, TEMPLATE_PREFIX } from "../../shared/ids.ts";
import { artifactsDir, BUNDLED_TEMPLATES_DIR, designDir, fsUrl, stateDir, userTemplatesDir } from "../../shared/paths.ts";
import {
	SESSION_COOKIE,
	type ArtifactMeta,
	BRIDGE_TOKEN_HEADER,
	type BridgeCallRequest,
	type McpCallResult,
	type McpToolInfo,
	mcpAllowed,
	mcpCallKey,
	normalizeMcpArgs,
	normalizeMcpToolName,
	type RuntimeError,
} from "../../shared/protocol.ts";
import { MEMORY_CHANGED_EVENT, TEMPLATE_CHANGED_EVENT } from "../src/lib/events.ts";
import { type ExportResult, exportArtifact } from "./export.ts";
import { Memory } from "./memory.ts";
import { SessionRegistry } from "./sessions.ts";
import { artifactPaths, deleteArtifact, listArtifacts, readMeta, type WriteArtifactInput, writeArtifact } from "./store.ts";
import { getTemplate } from "./templates.ts";
import { VIEWER_DIR } from "./vite-shared.ts";
import { needsVirtualModule, parseVirtualModuleUrl, virtualModuleUrl } from "./virtual-modules.ts";
import { RuntimeAliases } from "./runtime-aliases.ts";

const CONTEXT_KEY = Symbol.for("pi-artifacts.daemon");
/** Only same-origin paths ("/a/x"), never "//host", "/\\host" or control characters. */
function localPath(next: string): string {
	return /^\/(?![/\\])[^\s\\\u0000-\u001f\u007f]*$/.test(next) ? next : "/";
}

/** A browser session (cookie) lasts this long; the daemon's restart also ends it. */
const BROWSER_SESSION_TTL_MS = 7 * 24 * 3600_000;
/** Open links (one-time tokens in URLs given to people) stay valid this long. */
const LINK_TTL_MS = 30 * 60_000;
/** A page that pinged within this window counts as open (background tabs are throttled to ~1/min). */
const VIEWING_TTL_MS = 90_000;

interface WriteResult {
	meta: ArtifactMeta;
	created: boolean;
	path: string;
	compileError?: string;
	/** Errors an open browser tab reported for this version. */
	runtimeErrors: RuntimeError[];
	/** Whether a tab had the artifact open (so runtime errors were observed). */
	observed: boolean;
}

export class DaemonContext {
	readonly memory: Memory;
	readonly sessions = new SessionRegistry();
	readonly secret = randomBytes(24).toString("base64url");
	server: ViteDevServer | undefined;
	port = 0;
	lastActivity = performance.now();
	/** Set by the daemon entry: how `/__pi/api/shutdown` stops it (works on Windows too). */
	onShutdown: () => void = () => process.exit(0);
	/** One-time login tokens (in links given to people) → expiry and where they lead. */
	private links = new Map<string, { exp: number; next: string }>();
	/** Used tokens → destination, so a signed-in browser clicking a link again still gets there. */
	private spentLinks = new Map<string, { exp: number; next: string }>();
	/** Browser sessions (cookie values) → expiry. Distinct from the API secret. */
	private browserSessions = new Map<string, number>();
	private errors = new Map<string, { sequence: number; error: RuntimeError }[]>();
	private errorSequence = 0;
	private viewing = new Map<string, number>();
	private pendingMcpCalls = new Set<{ id: string; valid: boolean; key?: string }>();

	readonly version: string;
	readonly aliases: RuntimeAliases;

	constructor(version: string, memory?: Memory, aliases = new RuntimeAliases([])) {
		this.version = version;
		this.memory = memory ?? new Memory();
		this.aliases = aliases;
	}

	static install(ctx: DaemonContext): void {
		(globalThis as Record<symbol, unknown>)[CONTEXT_KEY] = ctx;
	}

	static current(): DaemonContext {
		const ctx = (globalThis as Record<symbol, unknown>)[CONTEXT_KEY] as DaemonContext | undefined;
		if (!ctx) throw new Error("pi-artifacts daemon context is not installed");
		return ctx;
	}

	get origin(): string {
		return `http://127.0.0.1:${this.port}`;
	}

	/** Record activity that should keep the daemon from its idle exit. */
	touch(): void {
		this.lastActivity = performance.now();
	}

	/** Keep unused links alive for their advertised lifetime even when pi has disconnected. */
	isIdle(idleMs: number): boolean {
		const now = performance.now();
		this.pruneLinks(now);
		return this.sessions.size === 0 && this.links.size === 0 && now - this.lastActivity > idleMs;
	}

	// ---- links ---------------------------------------------------------------------

	/** Cookie name, per port: two daemons (e.g. dev and tests) must not log each other out. */
	get cookieName(): string {
		return `${SESSION_COOKIE}_${this.port}`;
	}

	private pruneLinks(now = performance.now()) {
		for (const map of [this.links, this.spentLinks]) for (const [t, l] of map) if (l.exp < now) map.delete(t);
	}

	/** Use up a token (if still unused) and return where it leads. */
	private spend(token: string): { exp: number; next: string } | undefined {
		const link = this.links.get(token);
		if (!link) return undefined;
		this.links.delete(token);
		this.spentLinks.set(token, link);
		return link;
	}

	/**
	 * A URL that logs the browser in and opens `next`. The destination is stored with the
	 * token (the URL only carries the token), so links cannot be turned into redirects.
	 */
	link(next = "/"): string {
		this.pruneLinks();
		const token = randomBytes(18).toString("base64url");
		this.links.set(token, { exp: performance.now() + LINK_TTL_MS, next: localPath(next) });
		return `${this.origin}/__pi/login?t=${token}`;
	}

	/**
	 * For a browser that is already signed in: use the token up (so the link can no longer
	 * sign anyone else in) and return where it leads — also for links used before.
	 */
	followLink(token: string | null): string | undefined {
		this.pruneLinks();
		if (!token) return undefined;
		return (this.spend(token) ?? this.spentLinks.get(token))?.next;
	}

	/**
	 * Exchange a one-time link token for a browser session id (the cookie value). Tokens are
	 * deleted on use, so a link that leaked (logs, model context) stops working once opened.
	 */
	login(token: string | null): { session: string; next: string } | undefined {
		const now = performance.now();
		this.pruneLinks(now);
		const link = token ? this.spend(token) : undefined;
		if (!link) return undefined;
		const session = randomBytes(24).toString("base64url");
		this.browserSessions.set(session, now + BROWSER_SESSION_TTL_MS);
		return { session, next: link.next };
	}

	/** Whether a cookie value is a live browser session. */
	browserSession(value: string | undefined): boolean {
		if (!value) return false;
		const exp = this.browserSessions.get(value);
		if (exp === undefined) return false;
		if (exp < performance.now()) {
			this.browserSessions.delete(value);
			return false;
		}
		return true;
	}

	/** Constant-time check of the extension's API secret. */
	isSecret(value: unknown): boolean {
		if (typeof value !== "string") return false;
		const a = Buffer.from(value);
		const b = Buffer.from(this.secret);
		return a.length === b.length && timingSafeEqual(a, b);
	}

	// ---- artifacts -----------------------------------------------------------------

	listArtifacts(): Promise<ArtifactMeta[]> {
		return listArtifacts();
	}

	moduleUrl(kind: "a" | "t", name: string, file: string): string {
		const served = this.aliases.map(file);
		return needsVirtualModule(served) ? virtualModuleUrl(kind, name) : fsUrl(served);
	}

	/** What the artifact page needs: meta plus the module URL Vite serves. */
	async artifactView(id: string) {
		const meta = await readMeta(id);
		if (!meta) throw new Error(`Artifact "${id}" not found`);
		const file = artifactPaths(id).entry;
		return { ...meta, mcp: meta.mcp ?? [], moduleUrl: this.moduleUrl("a", id, file) };
	}

	/** A template rendered like an artifact (`/t/<name>`), with memory scope `template-<name>`. */
	async templateView(name: string) {
		const t = await getTemplate(name, BUNDLED_TEMPLATES_DIR);
		if (!t) throw new Error(`Template "${name}" not found`);
		const revision = t.revision ?? createHash("sha256").update(t.source).update("\0").update(t.code).digest("hex");
		return { id: `${TEMPLATE_PREFIX}${t.name}`, instanceId: revision, title: `Template: ${t.title}`, description: t.description, mcp: t.mcp ?? [], createdAt: 0, updatedAt: 0, moduleUrl: this.moduleUrl("t", t.name, t.path) };
	}

	/** Resolve only artifact and template entries under the allowed roots. */
	async moduleFile(moduleUrl: string): Promise<string> {
		const virtual = parseVirtualModuleUrl(moduleUrl);
		let asked: string;
		if (virtual?.kind === "a") {
			if (!(await readMeta(virtual.name))) throw new Error(`Artifact "${virtual.name}" not found`);
			asked = artifactPaths(virtual.name).entry;
		} else if (virtual?.kind === "t") {
			const template = await getTemplate(virtual.name, BUNDLED_TEMPLATES_DIR);
			if (!template) throw new Error(`Template "${virtual.name}" not found`);
			asked = template.path;
		} else {
			asked = resolvePath(decodeURIComponent(moduleUrl.replace(/^\/@fs\/?/, "/")).replace(/^\/([A-Za-z]:)/, "$1"));
		}
		const file = await realpath(asked).catch(() => asked);
		const state = await realpath(stateDir()).catch(() => resolvePath(stateDir()));
		const fromState = relative(state, file);
		if (fromState === "" || (fromState !== ".." && !fromState.startsWith(`..${sep}`) && !isAbsolute(fromState))) throw new Error("Not an artifact module");
		const roots = await Promise.all([
			{ path: artifactsDir(), entry: "index.tsx", artifact: true },
			{ path: userTemplatesDir(), entry: "template.tsx", artifact: false },
			{ path: BUNDLED_TEMPLATES_DIR, entry: "template.tsx", artifact: false },
		].map(async (root) => ({ ...root, path: await realpath(root.path).catch(() => resolvePath(root.path)) })));
		const allowed = roots.some((root) => {
			const parts = relative(root.path, file).split(sep);
			if (parts.length !== 2 || parts[1] !== root.entry || !isValidId(parts[0])) return false;
			if (!root.artifact) return true;
			try { assertArtifactId(parts[0]); return true; } catch { return false; }
		});
		if (!allowed) throw new Error("Not an artifact module");
		return file;
	}

	/** Source of an artifact or template module, for the Code tab (nothing else is readable). */
	async moduleSource(moduleUrl: string): Promise<string> {
		return readFile(await this.moduleFile(moduleUrl), "utf8");
	}

	/** Transform the entry and its local code dependencies; return the first error, if any. */
	async compileCheck(file: string, moduleUrl = fsUrl(file)): Promise<string | undefined> {
		const env = this.server?.environments.client;
		if (!env) return undefined;
		for (const m of env.moduleGraph.getModulesByFile(file) ?? []) env.moduleGraph.invalidateModule(m);
		const virtual = parseVirtualModuleUrl(moduleUrl) && env.moduleGraph.getModuleById(moduleUrl);
		if (virtual) env.moduleGraph.invalidateModule(virtual);
		try {
			// Match Vite's HTTP middleware, which decodes the request before transforming it.
			const entryUrl = decodeURI(moduleUrl);
			await env.transformRequest(entryUrl);
			const entry = await env.moduleGraph.getModuleByUrl(entryUrl);
			const root = resolvePath(file, "..");
			const physicalRoot = await realpath(root).catch(() => root);
			const pending = [...(entry?.importedModules ?? [])];
			const visited = new Set(pending);
			for (let i = 0; i < pending.length; i++) {
				const dependency = pending[i];
				// Raw assets and styles are fetched differently from JavaScript modules.
				if (!dependency.file || !/\.(?:[cm]?[jt]sx?|json)$/i.test(dependency.file) || /[?&](?:raw|url|inline)(?:&|$)/.test(dependency.url)) continue;
				const withinRoot = [root, physicalRoot].some((candidate) => {
					const local = relative(candidate, dependency.file!);
					return local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
				});
				if (!withinRoot) continue;
				env.moduleGraph.invalidateModule(dependency);
				await env.transformRequest(decodeURI(dependency.url));
				for (const child of dependency.importedModules) if (!visited.has(child)) { visited.add(child); pending.push(child); }
			}
			return undefined;
		} catch (error) {
			const e = error as { message?: string; frame?: string };
			// biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI colors
			const plain = [e.message, e.frame].filter(Boolean).join("\n").replace(/\u001b\[[0-9;]*m/g, "");
			return plain.slice(0, 4000) || String(error);
		}
	}

	/** Re-scan newly saved sources and refresh the linked stylesheet in open tabs. */
	async refreshStyles(): Promise<void> {
		const env = this.server?.environments.client;
		if (!env || !this.server) return;
		const modules = env.moduleGraph.getModulesByFile(join(VIEWER_DIR, "src/styles.css"));
		if (!modules?.size) return; // The first stylesheet request will scan the new source.
		for (const module of modules) env.moduleGraph.invalidateModule(module);
		await env.transformRequest("/src/styles.css?direct");
		this.server.ws.send({ type: "update", updates: [{ type: "css-update", path: "/src/styles.css", acceptedPath: "/src/styles.css", timestamp: Date.now() }] });
	}

	async writeArtifact(input: WriteArtifactInput, waitForRuntimeMs = 2500): Promise<WriteResult> {
		let started = 0;
		let compileError: string | undefined;
		let observed = false;
		let runtimeErrors: RuntimeError[] = [];
		const { meta, created } = await writeArtifact(input, undefined, {
			beforeWrite: () => { started = this.errorSequence; },
			afterWrite: async (written) => {
				for (const call of this.pendingMcpCalls) if (call.id === written.id) call.valid = false;
				this.memory.clearArtifactMcp(written.id);
				const file = artifactPaths(written.id).entry;
				compileError = await this.compileCheck(this.aliases.map(file), this.moduleUrl("a", written.id, file));
				await this.refreshStyles();
				observed = !compileError && this.isViewing(written.id);
				// Give an open tab time to hot-reload and report what broke.
				if (observed && waitForRuntimeMs > 0) await new Promise((r) => setTimeout(r, waitForRuntimeMs));
				runtimeErrors = (this.errors.get(written.id) ?? []).filter((entry) => entry.sequence > started).map((entry) => entry.error);
			},
		});
		const { entry } = artifactPaths(meta.id);
		return { meta, created, path: entry, compileError, runtimeErrors, observed };
	}

	async deleteArtifact(id: string): Promise<boolean> {
		return deleteArtifact(id, undefined, (deleted) => {
			for (const call of this.pendingMcpCalls) if (call.id === id) call.valid = false;
			if (!deleted) return;
			this.memory.forget(id);
			this.errors.delete(id);
			this.memoryChanged(id);
		});
	}

	/** Clear a deleted user template's preview state while its file lock is held. */
	forgetTemplatePreview(name: string, deleted = true): void {
		const id = `${TEMPLATE_PREFIX}${name}`;
		for (const call of this.pendingMcpCalls) if (call.id === id) call.valid = false;
		if (!deleted) return;
		this.memory.forget(id);
		this.errors.delete(id);
		this.viewing.delete(id);
		this.memoryChanged(id);
		this.templateChanged(name);
	}

	invalidateTemplateMcp(name: string): void {
		const id = `${TEMPLATE_PREFIX}${name}`;
		for (const call of this.pendingMcpCalls) if (call.id === id) call.valid = false;
		this.memory.clearArtifactMcp(id);
	}

	templateChanged(name: string): void {
		this.server?.ws.send({ type: "custom", event: TEMPLATE_CHANGED_EVENT, data: { name } });
	}

	reportError(id: string, message: string, stack?: string): void {
		if (!isValidRuntimeId(id)) return;
		const list = this.errors.get(id) ?? [];
		list.push({ sequence: ++this.errorSequence, error: { message: message.slice(0, 2000), stack: stack?.slice(0, 4000), at: Date.now() } });
		this.errors.set(id, list.slice(-10));
	}

	/** Tell open pages that the agent changed a memory scope, so they refetch it. */
	memoryChanged(scope: string): void {
		this.server?.ws.send({ type: "custom", event: MEMORY_CHANGED_EVENT, data: { scope } });
	}

	noteViewing(id: string): void {
		if (isValidRuntimeId(id)) this.viewing.set(id, performance.now());
	}

	isViewing(id: string): boolean {
		const lastSeen = this.viewing.get(id);
		return lastSeen !== undefined && lastSeen > performance.now() - VIEWING_TTL_MS;
	}

	// ---- memory ----------------------------------------------------------------------

	/** Validate a memory scope. */
	scope(scope: unknown): string {
		assertMemoryScope(scope);
		return scope;
	}

	// ---- MCP -------------------------------------------------------------------------

	/** Meta of an artifact or of a template preview (`template-<name>`). */
	async callerMeta(id: string): Promise<Pick<ArtifactMeta, "id" | "title" | "mcp" | "sessionId"> | undefined> {
		if (id.startsWith(TEMPLATE_PREFIX)) {
			const t = await getTemplate(id.slice(TEMPLATE_PREFIX.length), BUNDLED_TEMPLATES_DIR);
			return t && { id, title: `Template: ${t.title}`, mcp: t.mcp };
		}
		return readMeta(id);
	}

	mcpStatus() {
		return { connected: this.sessions.size > 0, ready: this.sessions.anyReady };
	}

	async mcpTools(): Promise<McpToolInfo[]> {
		const session = this.sessions.pick();
		if (!session) throw new Error("No pi session is connected: start pi (or run /artifacts in pi)");
		const res = await fetch(new URL("/mcp/tools", session.bridgeUrl), {
			headers: { [BRIDGE_TOKEN_HEADER]: session.bridgeToken },
			signal: AbortSignal.timeout(10_000),
		});
		const json = (await res.json()) as { tools?: McpToolInfo[]; error?: string };
		if (!res.ok) throw new Error(json.error ?? `Bridge error ${res.status}`);
		return json.tools ?? [];
	}

	async mcpCall(artifactId: unknown, rawName: unknown, args: unknown): Promise<McpCallResult> {
		if (!isValidRuntimeId(artifactId)) throw new Error("MCP calls need the calling artifact's id");
		if (typeof rawName !== "string") throw new Error("MCP tool name must be a string");
		const name = normalizeMcpToolName(rawName);
		const callArgs = normalizeMcpArgs(args);
		const pending = { id: artifactId, valid: true, key: mcpCallKey(name, callArgs) };
		for (const call of this.pendingMcpCalls) {
			if (call.id === artifactId && call.key === pending.key) call.valid = false;
		}
		this.pendingMcpCalls.add(pending);
		try {
			const meta = await this.callerMeta(artifactId);
			if (!meta) throw new Error(`Unknown artifact "${artifactId}"`);
			if (!mcpAllowed(meta.mcp, name)) {
				throw new Error(
					`${rawName} is not in this artifact's MCP allowlist (${meta.mcp?.join(", ") || "empty"}). Ask the agent to add it to the "mcp" list of artifact_write.`,
				);
			}
			const body: BridgeCallRequest = {
				name,
				args: callArgs,
				artifactId,
				artifactTitle: meta.title,
			};
			if (pending.valid) {
				this.memory.clearMcp(artifactId, pending.key);
			}
			const session = this.sessions.pick(meta.sessionId, name);
			if (!session) throw new Error("No pi session is connected: start pi (or run /artifacts in pi)");
			const res = await fetch(new URL("/mcp/call", session.bridgeUrl), {
				method: "POST",
				headers: { [BRIDGE_TOKEN_HEADER]: session.bridgeToken, "content-type": "application/json" },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(180_000),
			});
			const json = (await res.json()) as McpCallResult & { error?: string };
			if (!res.ok) throw new Error(json.error ?? `Bridge error ${res.status}`);
			const result: McpCallResult = { isError: json.isError, text: json.text, data: json.data };
			if (!result.isError && pending.valid) this.memory.cacheMcp(artifactId, pending.key, result);
			return result;
		} finally {
			this.pendingMcpCalls.delete(pending);
		}
	}

	// ---- export ----------------------------------------------------------------------

	async exportArtifact(id: string, outFile?: string, overwrite = false): Promise<ExportResult> {
		const meta = await readMeta(id);
		if (!meta) throw new Error(`No artifact "${id}"`);
		const entry = await this.moduleFile(fsUrl(artifactPaths(id).entry));
		return exportArtifact(this.memory, meta, this.aliases.map(entry), { themeCss: await this.themeCss(), outFile, overwrite, aliasRoots: this.aliases.paths });
	}

	// ---- design ----------------------------------------------------------------------

	async themeCss(): Promise<string> {
		const file = join(designDir(), "theme.css");
		return existsSync(file) ? readFile(file, "utf8") : "";
	}
}
