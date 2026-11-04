import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { VIEWER_DIR } from "@pi-artifacts/core";

export interface ViewerOptions {
	port?: number;
	env?: Record<string, string>;
	onLog?: (line: string) => void;
}

function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const srv = createServer();
		srv.once("error", () => resolve(false));
		srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
	});
}

export async function findFreePort(start: number, attempts = 20): Promise<number> {
	for (let p = start; p < start + attempts; p++) if (await isPortFree(p)) return p;
	throw new Error(`No free port in ${start}-${start + attempts - 1}`);
}

function viteBin(): string {
	const require = createRequire(join(VIEWER_DIR, "package.json"));
	return join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
}

async function waitForHttp(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`Viewer exited with code ${child.exitCode}`);
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
			if (res.status < 500) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`Viewer did not start within ${timeoutMs / 1000}s`);
}

/**
 * One Vite (TanStack Start) dev server for all artifacts. Every artifact is a
 * route of it, so they share one process, one module graph and HMR.
 */
export class Viewer {
	private child: ChildProcess | undefined;
	private starting: Promise<string> | undefined;
	private log: string[] = [];
	url: string | undefined;

	private readonly opts: ViewerOptions;

	constructor(opts: ViewerOptions = {}) {
		this.opts = opts;
	}

	get running(): boolean {
		return !!this.child && this.child.exitCode === null && !!this.url;
	}

	/** Recent server output, for error reports. */
	recentLog(lines = 40): string {
		return this.log.slice(-lines).join("\n");
	}

	/** Start (once) and return the base URL. */
	ensure(): Promise<string> {
		if (this.running && this.url) return Promise.resolve(this.url);
		this.starting ??= this.start().finally(() => {
			this.starting = undefined;
		});
		return this.starting;
	}

	private async start(): Promise<string> {
		const port = await findFreePort(this.opts.port ?? 5178);
		const child = spawn(process.execPath, [viteBin(), "dev", "--port", String(port), "--strictPort"], {
			cwd: VIEWER_DIR,
			env: { ...process.env, ...this.opts.env, PORT: String(port), FORCE_COLOR: "0" },
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		const onData = (buf: Buffer) => {
			for (const line of buf.toString("utf8").split("\n")) {
				if (!line.trim()) continue;
				this.log.push(line);
				this.opts.onLog?.(line);
			}
			if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
		};
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.on("exit", () => {
			if (this.child === child) {
				this.child = undefined;
				this.url = undefined;
			}
		});
		this.child = child;
		// The child runs in its own process group; make sure it dies with pi.
		const onExit = () => this.stop();
		process.once("exit", onExit);
		child.once("exit", () => process.off("exit", onExit));
		const url = `http://127.0.0.1:${port}`;
		try {
			await waitForHttp(`${url}/`, child, 60_000);
		} catch (error) {
			this.stop();
			throw new Error(`${(error as Error).message}\n${this.recentLog()}`);
		}
		this.url = url;
		return url;
	}

	stop(): void {
		const child = this.child;
		this.child = undefined;
		this.url = undefined;
		if (!child || child.exitCode !== null) return;
		try {
			// Kill the whole process group (vite may spawn workers).
			if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
			else child.kill("SIGTERM");
		} catch {
			child.kill("SIGTERM");
		}
	}
}

/**
 * Ask Vite to transform an artifact module. Syntax errors and unresolved
 * imports come back as an error message, so the agent can fix them before the
 * user looks.
 */
export async function checkModule(baseUrl: string, moduleUrl: string): Promise<string | undefined> {
	try {
		const res = await fetch(new URL(moduleUrl, baseUrl), { signal: AbortSignal.timeout(30_000) });
		if (res.ok) return undefined;
		return extractViteError(await res.text()) || `HTTP ${res.status}`;
	} catch (error) {
		return `Could not check the module: ${(error as Error).message}`;
	}
}

/** Pull the error message out of Vite's error response (JSON, or an HTML/JS error page). */
export function extractViteError(body: string): string {
	try {
		const json = JSON.parse(body) as { message?: string; error?: { message?: string } };
		const msg = json.message ?? json.error?.message;
		if (msg) return msg;
	} catch {}
	const m = /"message":"((?:[^"\\]|\\.)*)"/.exec(body);
	if (m) {
		try {
			return JSON.parse(`"${m[1]}"`) as string;
		} catch {}
	}
	return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
}
