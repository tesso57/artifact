/**
 * The daemon's state and operations, shared by its HTTP API (pi extension), the server
 * functions (browser) and the exporter. One instance per daemon process, reachable from
 * server functions through `globalThis` (they run in Vite's module runner).
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath, sep } from "node:path";
import { join } from "node:path";
import type { ViteDevServer } from "vite";
import { isValidId, SHARED_SCOPE } from "../../shared/ids.ts";
import { artifactsDir, BUNDLED_TEMPLATES_DIR, designDir, fsUrl, userTemplatesDir } from "../../shared/paths.ts";
import {
	type ArtifactMeta,
	BRIDGE_TOKEN_HEADER,
	type BridgeCallRequest,
	type McpCallResult,
	type McpToolInfo,
	mcpAllowed,
	mcpCallKey,
	normalizeMcpToolName,
	type RuntimeError,
} from "../../shared/protocol.ts";
import { type ExportResult, exportArtifact } from "./export.ts";
import { Memory } from "./memory.ts";
import { SessionRegistry } from "./sessions.ts";
import { artifactPaths, deleteArtifact, listArtifacts, readMeta, type WriteArtifactInput, writeArtifact } from "./store.ts";
import { getTemplate } from "./templates.ts";

const CONTEXT_KEY = Symbol.for("pi-artifacts.daemon");
/** Open links (tokens in URLs given to people) stay valid this long. */
const LINK_TTL_MS = 30 * 60_000;
/** A page that pinged within this window counts as open. */
const VIEWING_TTL_MS = 20_000;

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
	lastActivity = Date.now();
	private links = new Map<string, number>();
	private errors = new Map<string, RuntimeError[]>();
	private viewing = new Map<string, number>();

	readonly version: string;

	constructor(version: string, memory?: Memory) {
		this.version = version;
		this.memory = memory ?? new Memory();
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

	touch(): void {
		this.lastActivity = Date.now();
	}

	// ---- links ---------------------------------------------------------------------

	/** A URL that logs the browser in (sets the session cookie) and opens `next`. */
	link(next = "/"): string {
		const token = randomBytes(18).toString("base64url");
		this.links.set(token, Date.now() + LINK_TTL_MS);
		return `${this.origin}/__pi/login?t=${token}&next=${encodeURIComponent(next)}`;
	}

	/** Accept the master secret or an unexpired link token. */
	acceptLogin(token: string | null): boolean {
		if (!token) return false;
		if (token === this.secret) return true;
		const exp = this.links.get(token);
		for (const [t, e] of this.links) if (e < Date.now()) this.links.delete(t);
		return exp !== undefined && exp > Date.now();
	}

	// ---- artifacts -----------------------------------------------------------------

	listArtifacts(): Promise<ArtifactMeta[]> {
		return listArtifacts();
	}

	/** What the artifact page needs: meta plus the module URL Vite serves. */
	async artifactView(id: string) {
		const meta = await readMeta(id);
		if (!meta) throw new Error(`Artifact "${id}" not found`);
		return { ...meta, mcp: meta.mcp ?? [], moduleUrl: fsUrl(artifactPaths(id).entry) };
	}

	/** A template rendered like an artifact (`/t/<name>`), with memory scope `template-<name>`. */
	async templateView(name: string) {
		const t = await getTemplate(name, BUNDLED_TEMPLATES_DIR);
		if (!t) throw new Error(`Template "${name}" not found`);
		return { id: `template-${t.name}`, title: `Template: ${t.title}`, description: t.description, mcp: t.mcp ?? [], createdAt: 0, updatedAt: 0, moduleUrl: fsUrl(t.path) };
	}

	/** Source of an artifact or template module, for the Code tab (nothing else is readable). */
	async moduleSource(moduleUrl: string): Promise<string> {
		const file = resolvePath(moduleUrl.replace(/^\/@fs\/?/, "/").replace(/^\/([A-Za-z]:)/, "$1"));
		const roots = [artifactsDir(), userTemplatesDir(), BUNDLED_TEMPLATES_DIR].map((r) => resolvePath(r) + sep);
		if (!/[\\/](index|template)\.tsx$/.test(file) || !roots.some((r) => file.startsWith(r))) throw new Error("Not an artifact module");
		return readFile(file, "utf8");
	}

	/** Transform a module like the browser would; returns the error message, if any. */
	async compileCheck(file: string): Promise<string | undefined> {
		const env = this.server?.environments.client;
		if (!env) return undefined;
		for (const m of env.moduleGraph.getModulesByFile(file) ?? []) env.moduleGraph.invalidateModule(m);
		try {
			await env.transformRequest(fsUrl(file));
			return undefined;
		} catch (error) {
			const e = error as { message?: string; frame?: string };
			// biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI colors
			const plain = [e.message, e.frame].filter(Boolean).join("\n").replace(/\u001b\[[0-9;]*m/g, "");
			return plain.slice(0, 4000) || String(error);
		}
	}

	async writeArtifact(input: WriteArtifactInput, waitForRuntimeMs = 2500): Promise<WriteResult> {
		const started = Date.now();
		const { meta, created } = await writeArtifact(input);
		const { entry } = artifactPaths(meta.id);
		const compileError = await this.compileCheck(entry);
		const observed = !compileError && this.isViewing(meta.id);
		// Give an open tab time to hot-reload and report what broke.
		if (observed && waitForRuntimeMs > 0) await new Promise((r) => setTimeout(r, waitForRuntimeMs));
		const runtimeErrors = (this.errors.get(meta.id) ?? []).filter((e) => e.at >= started);
		return { meta, created, path: entry, compileError, runtimeErrors, observed };
	}

	async deleteArtifact(id: string): Promise<boolean> {
		const deleted = await deleteArtifact(id);
		this.memory.forget(id);
		this.errors.delete(id);
		return deleted;
	}

	reportError(id: string, message: string, stack?: string): void {
		if (!isValidId(id)) return;
		const list = this.errors.get(id) ?? [];
		list.push({ message: message.slice(0, 2000), stack: stack?.slice(0, 4000), at: Date.now() });
		this.errors.set(id, list.slice(-10));
	}

	noteViewing(id: string): void {
		if (isValidId(id)) this.viewing.set(id, Date.now());
	}

	isViewing(id: string): boolean {
		return (this.viewing.get(id) ?? 0) > Date.now() - VIEWING_TTL_MS;
	}

	// ---- memory ----------------------------------------------------------------------

	/** Validate a memory scope; reads of "shared" by an artifact are recorded for exports. */
	scope(scope: unknown, from?: unknown, key?: string): string {
		if (!isValidId(scope)) throw new Error(`Invalid memory scope ${JSON.stringify(scope)}`);
		if (scope === SHARED_SCOPE && isValidId(from)) this.memory.noteSharedRead(from, key ?? "*");
		return scope;
	}

	// ---- MCP -------------------------------------------------------------------------

	/** Meta of an artifact or of a template preview (`template-<name>`). */
	async callerMeta(id: string): Promise<Pick<ArtifactMeta, "id" | "title" | "mcp" | "sessionId"> | undefined> {
		if (id.startsWith("template-")) {
			const t = await getTemplate(id.slice("template-".length), BUNDLED_TEMPLATES_DIR);
			return t && { id, title: `Template: ${t.title}`, mcp: t.mcp };
		}
		return readMeta(id);
	}

	mcpStatus() {
		return { connected: this.sessions.size > 0 };
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
		if (!isValidId(artifactId)) throw new Error("MCP calls need the calling artifact's id");
		if (typeof rawName !== "string") throw new Error("MCP tool name must be a string");
		const name = normalizeMcpToolName(rawName);
		const meta = await this.callerMeta(artifactId);
		if (!meta) throw new Error(`Unknown artifact "${artifactId}"`);
		if (!mcpAllowed(meta.mcp, name)) {
			throw new Error(
				`${rawName} is not in this artifact's MCP allowlist (${meta.mcp?.join(", ") || "empty"}). Ask the agent to add it to the "mcp" list of artifact_write.`,
			);
		}
		const session = this.sessions.pick(meta.sessionId);
		if (!session) throw new Error("No pi session is connected: start pi (or run /artifacts in pi)");
		const body: BridgeCallRequest = {
			name,
			args: (args && typeof args === "object" ? args : {}) as Record<string, unknown>,
			artifactId,
			artifactTitle: meta.title,
		};
		const res = await fetch(new URL("/mcp/call", session.bridgeUrl), {
			method: "POST",
			headers: { [BRIDGE_TOKEN_HEADER]: session.bridgeToken, "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(180_000),
		});
		const json = (await res.json()) as McpCallResult & { error?: string };
		if (!res.ok) throw new Error(json.error ?? `Bridge error ${res.status}`);
		const result: McpCallResult = { isError: json.isError, text: json.text, data: json.data };
		if (!result.isError) this.memory.cacheMcp(artifactId, mcpCallKey(name, body.args), result);
		return result;
	}

	// ---- export ----------------------------------------------------------------------

	async exportArtifact(id: string, outFile?: string): Promise<ExportResult> {
		const meta = await readMeta(id);
		if (!meta) throw new Error(`No artifact "${id}"`);
		return exportArtifact(this.memory, meta, { themeCss: await this.themeCss(), outFile });
	}

	// ---- design ----------------------------------------------------------------------

	async themeCss(): Promise<string> {
		const file = join(designDir(), "theme.css");
		return existsSync(file) ? readFile(file, "utf8") : "";
	}
}
