/**
 * End-to-end check with a real pi session (faux model, real extension, real MCP server):
 *   node test/e2e/run.ts
 * The faux model calls artifact_write; then a browser opens the artifact, which calls the
 * MCP server through pi and stores data in SQLite memory.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	createMcpExtension,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const agentDir = mkdtempSync(join(tmpdir(), "pi-agent-"));
// Keep test artifacts and memory out of ~/.pi/artifacts.
process.env.PI_ARTIFACTS_DIR ??= mkdtempSync(join(tmpdir(), "pi-artifacts-e2e-"));
const cwd = mkdtempSync(join(tmpdir(), "pi-cwd-"));

const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
const id = `e2e-mcp-demo`;
faux.setResponses([
	fauxAssistantMessage(
		fauxToolCall("artifact_write", {
			id,
			title: "MCP demo",
			description: "Chart + reverse via the echo MCP server",
			code: readFileSync(join(here, "demo-artifact.tsx"), "utf8"),
		}),
	),
	fauxAssistantMessage("Done — open the artifact."),
]);

const resourceLoader = new DefaultResourceLoader({
	cwd,
	agentDir,
	additionalExtensionPaths: [join(root, "packages/extension")],
	extensionFactories: [
		(pi) => {
			pi.registerProvider(faux.provider as never);
			pi.registerMcpServer("echo", { command: process.execPath, args: [join(here, "echo-mcp-server.mjs")] });
		},
		createMcpExtension(),
	],
});
await resourceLoader.reload();
const settingsManager = SettingsManager.inMemory?.() ?? SettingsManager.create(cwd, agentDir);

const { session } = await createAgentSession({
	cwd,
	agentDir,
	resourceLoader,
	settingsManager,
	sessionManager: SessionManager.inMemory(),
});
const model = session.modelRuntime?.getModel?.("faux", "faux-1") ?? faux.getModel();
await session.setModel(model as never);
await session.bindExtensions({});

let failed = false;
try {
	await session.prompt("Build an MCP demo artifact");
	if (process.env.E2E_DEBUG) {
		await new Promise((r) => setTimeout(r, 3000));
		console.log("ALL TOOLS:", (session as any).getAllTools?.().map((t: any) => `${t.name}:${t.exposure ?? ""}`).join(", "));
		console.log("CALLABLE:", (session as any).getCallableToolNames?.()?.join(", "));
		console.log("AGENT DIR mcp.log:", (() => { try { return readFileSync(join(agentDir, "mcp.log"), "utf8"); } catch { return "-"; } })());
	}
	const result = session.messages.findLast((m: any) => m.role === "toolResult" && m.toolName === "artifact_write") as any;
	const text = result?.content?.map((c: any) => c.text).join("\n") ?? "";
	console.log("artifact_write result:\n" + text);
	if (result?.isError) throw new Error("artifact_write reported an error");
	const url = /URL: (\S+)/.exec(text)?.[1];
	if (!url) throw new Error("no URL");

	const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright");
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1100, height: 650 }, deviceScaleFactor: 2 });
	const errors: string[] = [];
	page.on("pageerror", (e: Error) => errors.push(e.message));
	await page.goto(url, { waitUntil: "networkidle" });
	await page
		.getByText("★ 1234")
		.waitFor({ timeout: 20000 })
		.catch(async (e: Error) => {
			console.log("PAGE TEXT:", (await page.innerText("body")).slice(0, 1500));
			throw e;
		});
	// Tailwind picked up the artifact's classes (two columns) and recharts drew bars.
	await page.locator(".recharts-bar-rectangle").first().waitFor({ timeout: 10000 });
	const boxes = await page.locator("[data-slot=card]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
	if (boxes.length !== 2 || Math.abs(boxes[0] - boxes[1]) > 2) throw new Error(`expected two cards side by side, got tops ${boxes}`);
	await page.getByRole("button", { name: "Reverse" }).click();
	await page.getByTestId("history").getByText("ip olleh").waitFor({ timeout: 20000 });
	await page.waitForTimeout(800);
	await page.screenshot({ path: process.env.E2E_SCREENSHOT ?? join(tmpdir(), "pi-artifacts-e2e.png") });
	await page.reload({ waitUntil: "networkidle" });
	await page.getByTestId("history").getByText("ip olleh").waitFor({ timeout: 20000 });
	await browser.close();
	if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);

	// The agent sees what the artifact stored.
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "get", scope: id, key: "history" })),
		fauxAssistantMessage("ok"),
	]);
	await session.prompt("What did I reverse?");
	const mem = session.messages.findLast((m: any) => m.role === "toolResult" && m.toolName === "artifact_memory") as any;
	const memText = mem.content[0].text;
	console.log("artifact_memory:", memText.replace(/\s+/g, " "));
	if (!memText.includes("ip olleh")) throw new Error("memory not visible to the agent");
	console.log("\nE2E OK");
} catch (error) {
	failed = true;
	console.error("E2E FAILED:", error);
} finally {
	session.dispose();
	await new Promise((r) => setTimeout(r, 300));
	process.exit(failed ? 1 : 0);
}
