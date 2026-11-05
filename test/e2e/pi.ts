/** Helpers to drive real pi SDK sessions with a faux model, this package and an MCP server. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxProvider, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	createMcpExtension,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const here = dirname(fileURLToPath(import.meta.url));
/** The package under test: this checkout, or an installed copy (PI_ARTIFACTS_PACKAGE). */
export const PACKAGE = process.env.PI_ARTIFACTS_PACKAGE ?? resolve(here, "../..");

export interface TestSession {
	session: Awaited<ReturnType<typeof createAgentSession>>["session"];
	cwd: string;
	respond(steps: FauxResponseStep[]): void;
	prompt(text: string): Promise<void>;
	lastResult(tool: string): { text: string; isError: boolean };
	results(tool: string): { text: string; isError: boolean }[];
	skills: string[];
	/** Emit session_shutdown (like quitting pi or /new) and dispose. */
	close(): Promise<void>;
}

export async function startPi(): Promise<TestSession> {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-cwd-"));
	const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
	// Load the package like `pi install` would (manifest: extensions + skills).
	const settingsManager = SettingsManager.inMemory({ packages: [PACKAGE] } as never);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: [
			(pi) => {
				pi.registerProvider(faux.provider as never);
				pi.registerMcpServer("echo", { command: process.execPath, args: [join(here, "echo-mcp-server.mjs")] });
			},
			createMcpExtension(),
		],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({ cwd, agentDir, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory() });
	await session.setModel((session.modelRuntime?.getModel?.("faux", "faux-1") ?? faux.getModel()) as never);
	await session.bindExtensions({});

	const results = (tool: string) =>
		(session.messages as any[])
			.filter((m) => m.role === "toolResult" && m.toolName === tool)
			.map((m) => ({ text: (m.content ?? []).map((c: any) => c.text).join("\n"), isError: !!m.isError }));
	return {
		session,
		cwd,
		skills: resourceLoader.getSkills().skills.map((s) => s.name).sort(),
		respond: (steps) => faux.setResponses(steps),
		prompt: (text) => session.prompt(text),
		results,
		lastResult: (tool) => {
			const r = results(tool).at(-1);
			if (!r) throw new Error(`no ${tool} result`);
			return r;
		},
		close: async () => {
			await (session as any)._extensionRunner?.emit?.({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		},
	};
}

/** The "Open:" login link of an artifact_write / artifact_template result. */
export function openLink(text: string, label = "Open"): string {
	const m = new RegExp(`${label}: (\\S+)`).exec(text);
	if (!m) throw new Error(`no ${label} link in:\n${text}`);
	return m[1];
}
