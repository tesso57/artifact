/**
 * End-to-end: real pi SDK sessions (faux model) load this package like `pi install`, write an
 * artifact, and a browser uses it through the per-user viewer daemon:
 *   node test/e2e/run.ts            (this checkout)
 *   PI_ARTIFACTS_PACKAGE=… node …   (an installed copy, see pack.ts)
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { launchBrowser } from "./browser.ts";
import { openLink, PACKAGE, startPi } from "./pi.ts";

const here = dirname(fileURLToPath(import.meta.url));
// Keep test artifacts, memory and the daemon's state out of ~/.pi/artifacts.
process.env.PI_ARTIFACTS_DIR ??= mkdtempSync(join(tmpdir(), "pi-artifacts-e2e-"));
process.env.PI_ARTIFACTS_PORT ??= "5390";
const dir = process.env.PI_ARTIFACTS_DIR;
mkdirSync(join(dir, ".design"), { recursive: true });
writeFileSync(join(dir, ".design", "theme.css"), ":root { --radius: 0.1234rem; }\n");

const step = (msg: string) => console.log(`✓ ${msg}`);
const id = "e2e-mcp-demo";
const demo = readFileSync(join(here, "demo-artifact.tsx"), "utf8");
let failed = false;
const first = await startPi();
let second: Awaited<ReturnType<typeof startPi>> | undefined;
const browser = await launchBrowser();

try {
	if (first.skills.join() !== "artifact-design-system,artifact-template-creator,artifacts") throw new Error(`skills: ${first.skills}`);
	step("package manifest loads the extension and 3 skills");

	// 1. Write an artifact that uses MCP (allowlisted) and memory.
	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_write", { id, title: "MCP demo", description: "Chart + reverse via echo", code: demo, mcp: ["echo.*"] })),
		fauxAssistantMessage("Done."),
	]);
	await first.prompt("Build an MCP demo artifact");
	const write = first.lastResult("artifact_write");
	if (write.isError) throw new Error(write.text);
	step("artifact_write created the artifact and started the viewer daemon");

	const page = await browser.newPage({ viewport: { width: 1100, height: 650 }, deviceScaleFactor: 2 });
	const pageErrors: string[] = [];
	page.on("pageerror", (e: Error) => pageErrors.push(e.message));
	if (process.env.E2E_DEBUG) page.on("console", (m: any) => console.log("[console]", m.text().slice(0, 160)));
	await page.goto(openLink(write.text), { waitUntil: "networkidle" });
	await page
		.getByText("★ 1234")
		.waitFor({ timeout: 30000 })
		.catch(async (e: Error) => {
			console.log("PAGE TEXT:", (await page.innerText("body")).slice(0, 1500));
			throw e;
		});
	await page.locator(".recharts-bar-rectangle").first().waitFor({ timeout: 10000 });
	const tops = await page.locator("[data-slot=card]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
	if (tops.length !== 2 || Math.abs(tops[0] - tops[1]) > 2) throw new Error(`expected two cards side by side, got ${tops}`);
	const radius = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--radius").trim());
	if (radius !== "0.1234rem") throw new Error(`theme.css not applied (--radius: ${radius})`);
	step("login link → page renders MCP data, Tailwind classes, recharts and theme.css");

	// Artifacts (any script in the page) cannot read real files outside the viewer's roots:
	// next to the package (e.g. a home folder holding a checkout), in temp, or daemon state.
	// (When installed, the package's parent is the dependency folder, which is served on
	// purpose; probe the folder that holds it instead.)
	const parent = basename(dirname(PACKAGE)) === "node_modules" ? dirname(dirname(PACKAGE)) : dirname(PACKAGE);
	const besidePackage = join(parent, `.pi-artifacts-probe-${process.pid}.txt`);
	const inTemp = join(mkdtempSync(join(tmpdir(), "pi-probe-")), "secret.txt");
	for (const f of [besidePackage, inTemp]) writeFileSync(f, "secret");
	try {
		const outside = await page.evaluate(async (paths) => {
			const out: Record<string, number> = {};
			for (const p of paths) out[p] = (await fetch(`/@fs${p}`)).status;
			return out;
		}, [besidePackage, inTemp, join(dir, ".state", "memory.sqlite"), join(dir, ".state", "viewer.json")]);
		if (Object.values(outside).some((s) => s !== 403)) throw new Error(`readable outside the allow list: ${JSON.stringify(outside)}`);
	} finally {
		rmSync(besidePackage, { force: true });
	}
	step("/@fs outside the viewer, artifacts and templates is refused");

	await page.getByRole("button", { name: "Reverse" }).click();
	await page.getByTestId("history").getByText("ip olleh").waitFor({ timeout: 20000 });
	await page.waitForTimeout(500);
	await page.screenshot({ path: process.env.E2E_SCREENSHOT ?? join(tmpdir(), "pi-artifacts-e2e.png") });
	await page.reload({ waitUntil: "networkidle" });
	await page.getByTestId("history").getByText("ip olleh").waitFor({ timeout: 20000 });
	step("MCP mutation + SQLite memory survive a reload");

	// 2. Runtime errors in an open tab come back to the agent.
	first.respond([
		fauxAssistantMessage(
			fauxToolCall("artifact_write", { id, title: "MCP demo", code: 'export default function Broken() { throw new Error("boom from render"); }', mcp: ["echo.*"] }),
		),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Break it");
	const broken = first.lastResult("artifact_write");


	if (!broken.isError || !broken.text.includes("boom from render")) throw new Error(`runtime error not reported:\n${broken.text}`);
	step("artifact_write returns runtime errors reported by the open tab");
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id, title: "MCP demo", code: demo, mcp: ["echo.*"] })), fauxAssistantMessage("ok")]);
	await first.prompt("Fix it");
	if (first.lastResult("artifact_write").isError) throw new Error(first.lastResult("artifact_write").text);
	await page.getByText("★ 1234").waitFor({ timeout: 30000 });

	// 3. The allowlist is enforced.
	first.respond([
		fauxAssistantMessage(
			fauxToolCall("artifact_write", {
				title: "No MCP",
				code: 'import { useMcp } from "@pi/artifact";\nexport default function N() { const q = useMcp("echo.stats"); return <p data-testid="s">{q.error ? String(q.error.message) : q.isPending ? "…" : "ok"}</p>; }',
			}),
		),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Write an artifact without an allowlist");
	const noMcp = await browser.newPage();
	await noMcp.goto(openLink(first.lastResult("artifact_write").text));
	await noMcp.getByText(/not in this artifact's MCP allowlist/).waitFor({ timeout: 20000 });
	await noMcp.close();
	step("MCP calls outside the artifact's allowlist are refused");

	// Tools that are not read-only need approval; without a UI (this SDK session) it is declined.
	first.respond([
		fauxAssistantMessage(
			fauxToolCall("artifact_write", {
				title: "Writer",
				mcp: ["echo.note"],
				code: 'import { useMcp } from "@pi/artifact";\nexport default function W() { const q = useMcp("echo.note", { text: "x" }, { retry: false }); return <p>{q.error ? String(q.error.message) : q.isPending ? "…" : q.data?.text}</p>; }',
			}),
		),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Write an artifact that writes");
	const writer = await browser.newPage();
	await writer.goto(openLink(first.lastResult("artifact_write").text));
	await writer.getByText(/declined mcp__echo__note/).waitFor({ timeout: 20000 });
	await writer.close();
	step("non-read-only MCP tools need approval (declined without a UI)");

	// 4. The agent reads what the artifact stored.
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "get", scope: id, key: "history" })), fauxAssistantMessage("ok")]);
	await first.prompt("What did I reverse?");
	if (!first.lastResult("artifact_memory").text.includes("ip olleh")) throw new Error("memory not visible to the agent");
	step("artifact_memory reads the artifact's memory");

	// 5. Export: one file, embeds own memory and cached MCP results, reports what it embeds.
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id, path: "demo.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export it");
	const exported = first.lastResult("artifact_export").text;
	const html = readFileSync(join(first.cwd, "demo.html"), "utf8");
	if (!html.includes("ip olleh") || !html.includes('\\"stars\\":1234') || !/1 memory key/.test(exported)) throw new Error(`export:\n${exported}`);
	const offline = await browser.newPage();
	const requests: string[] = [];
	offline.on("request", (r: { url(): string }) => !/^(file|data|blob):/.test(r.url()) && requests.push(r.url()));
	offline.on("console", (m: any) => process.env.E2E_DEBUG && console.log("[offline]", m.text().slice(0, 300)));
	offline.on("pageerror", (e: Error) => process.env.E2E_DEBUG && console.log("[offline error]", e.message));
	await offline.goto(`file://${join(first.cwd, "demo.html")}`);
	if (process.env.E2E_DEBUG) {
		await offline.waitForTimeout(2000);
		console.log("OFFLINE:", (await offline.innerText("body")).slice(0, 500));
	}
	await offline.getByText("★ 1234").waitFor({ timeout: 10000 });
	if (requests.length) throw new Error(`export made network requests: ${requests}`);
	await offline.close();
	step(`artifact_export: ${(html.length / 1024).toFixed(0)} KB, works offline from file://`);

	// Mermaid diagrams render in the viewer and in an offline export.
	first.respond([
		fauxAssistantMessage(
			fauxToolCall("artifact_write", {
				id: "e2e-diagram",
				title: "Diagram",
				code: readFileSync(join(PACKAGE, "skills/artifacts/templates/diagram/template.tsx"), "utf8"),
			}),
		),
		fauxAssistantMessage(fauxToolCall("artifact_export", { id: "e2e-diagram", path: "diagram.html" })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Draw the checkout flow");
	const diagram = await browser.newPage();
	await diagram.goto(openLink(first.lastResult("artifact_write").text));
	await diagram.locator("[data-mermaid] svg").first().waitFor({ timeout: 30000 });
	await diagram.close();
	const offlineDiagram = await browser.newPage();
	await offlineDiagram.goto(`file://${join(first.cwd, "diagram.html")}`);
	await offlineDiagram.locator("[data-mermaid] svg").first().waitFor({ timeout: 30000 });
	await offlineDiagram.close();
	step("Mermaid diagrams render in the viewer and offline in an export");

	// 6. Templates: list, save (compile-checked) and preview.
	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_template", { action: "list" })),
		fauxAssistantMessage(
			fauxToolCall("artifact_template", {
				action: "save",
				name: "e2e-hello",
				title: "Hello",
				description: "Says hello",
				useCases: ["greet someone"],
				code: 'export default function Hello() { return <p className="text-[31px]">hello template</p>; }',
			}),
		),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Make a template");
	const [listed, saved] = first.results("artifact_template").slice(-2);
	const names = (JSON.parse(listed.text).templates as { name: string }[]).map((t) => t.name);
	for (const n of ["dashboard", "data-table", "diagram", "form-tool", "mcp-explorer", "style-guide"]) if (!names.includes(n)) throw new Error(`template ${n} missing: ${names}`);
	const preview = await browser.newPage();
	await preview.goto(openLink(saved.text, "Preview"));
	await preview.getByText("hello template").waitFor({ timeout: 20000 });
	await preview.close();
	step(`artifact_template: ${names.length} templates; saved one renders at /t/e2e-hello`);

	// 7. Sessions: a second pi session joins the same viewer; after the first quits, the
	//    viewer keeps running and MCP is routed to the second session.
	second = await startPi();
	second.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id, title: "MCP demo", code: demo, mcp: ["echo.*"] })), fauxAssistantMessage("ok")]);
	await second.prompt("Refresh the demo");
	await first.close();
	await page.reload({ waitUntil: "networkidle" });
	await page.getByText("★ 1234").waitFor({ timeout: 30000 });
	await page.getByRole("button", { name: "Reverse" }).click();
	await page.waitForTimeout(1500);
	if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join("; ")}`);
	step("viewer survives the first session; MCP routes to the second");

	console.log("\nE2E OK");
} catch (error) {
	failed = true;
	console.error("E2E FAILED:", error);
} finally {
	await browser.close().catch(() => {});
	// Stop the daemon so the test leaves nothing running.
	try {
		const state = JSON.parse(readFileSync(join(dir, ".state", "viewer.json"), "utf8"));
		await fetch(`${state.url}/__pi/api/shutdown`, { method: "POST", headers: { "x-pi-artifacts-secret": state.secret } });
	} catch {}
	await second?.close().catch(() => {});
	await first.close().catch(() => {});
	await new Promise((r) => setTimeout(r, 500));
	process.exit(failed ? 1 : 0);
}
