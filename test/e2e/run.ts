/**
 * End-to-end: real pi SDK sessions (faux model) load this package like `pi install`, write an
 * artifact, and a browser uses it through the per-user viewer daemon:
 *   node test/e2e/run.ts            (this checkout)
 *   PI_ARTIFACTS_PACKAGE=… node …   (an installed copy, see pack.ts)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { fsUrl } from "../../shared/paths.ts";
import { launchBrowser } from "./browser.ts";
import { openLink, PACKAGE, startPi } from "./pi.ts";
import { isolateTestEnvironment } from "./environment.ts";

const here = dirname(fileURLToPath(import.meta.url));
// Keep test artifacts, memory and the daemon's state out of ~/.pi/artifacts.
const customTemplates = Boolean(process.env.PI_ARTIFACTS_TEMPLATES);
const testEnvironment = isolateTestEnvironment(process.env);
process.env.PI_ARTIFACTS_PORT ??= "5390";
const dir = testEnvironment.dir;
mkdirSync(join(dir, ".design"), { recursive: true });
writeFileSync(join(dir, ".design", "theme.css"), ":root { --radius: 0.1234rem; }\n");

const step = (msg: string) => console.log(`✓ ${msg}`);
const temporaryDirs = new Set<string>();
const temporaryDir = (prefix: string) => {
	const path = mkdtempSync(join(tmpdir(), prefix));
	temporaryDirs.add(path);
	return path;
};
const removeTemporaryDir = (path: string) => {
	rmSync(path, { recursive: true, force: true });
	temporaryDirs.delete(path);
};
const id = "e2e-mcp-demo";
const demo = readFileSync(join(here, "demo-artifact.tsx"), "utf8");
let failed = false;
let first: Awaited<ReturnType<typeof startPi>> | undefined;
let second: Awaited<ReturnType<typeof startPi>> | undefined;
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const navigationEvents: string[] = [];
const reloadCounts = new Map<string, number>();
const recordNavigationEvent = (event: string) => {
	navigationEvents.push(event);
	if (navigationEvents.length > 50) navigationEvents.shift();
};

try {
	first = await startPi();
	browser = await launchBrowser();
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
	page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => {
		if (typeof payload !== "string") return;
		try {
			const message: unknown = JSON.parse(payload);
			if (message && typeof message === "object" && "type" in message && message.type === "full-reload") {
				const detail = message as { path?: unknown; ifFallback?: unknown; triggeredBy?: unknown };
				const scope = detail.path === "*" ? "all" : typeof detail.path === "string" ? "scoped" : "unspecified";
				const kind = `scope=${scope} fallback=${detail.ifFallback === true} file=${typeof detail.triggeredBy === "string" ? basename(detail.triggeredBy) : "unspecified"}`;
				reloadCounts.set(kind, (reloadCounts.get(kind) ?? 0) + 1);
				recordNavigationEvent(`vite: full-reload ${kind}`);
			}
		} catch {}
	}));
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Network.enable");
	cdp.on("Network.requestWillBeSent", (event) => {
		if (event.type !== "Document") return;
		let path = "unknown";
		try { path = new URL(event.request.url).pathname; } catch {}
		const frame = event.initiator.stack?.callFrames[0];
		let source = "";
		if (frame?.url) {
			try { source = ` ${new URL(frame.url).pathname}:${frame.lineNumber + 1}`; } catch {}
		}
		recordNavigationEvent(`initiator: ${path} ${event.initiator.type}${source}`);
	});
	page.on("request", (request) => {
		if (request.isNavigationRequest()) recordNavigationEvent(`request: ${new URL(request.url()).pathname}`);
	});
	page.on("requestfailed", (request) => {
		if (request.isNavigationRequest()) recordNavigationEvent(`failed: ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? "unknown"}`);
	});
	page.on("framenavigated", (frame) => {
		if (frame === page.mainFrame()) {
			try { recordNavigationEvent(`frame: ${new URL(frame.url()).pathname}`); }
			catch { recordNavigationEvent("frame: non-URL navigation"); }
		}
	});
	page.on("console", (message) => {
		const text = message.text();
		if (text.startsWith("[vite]")) recordNavigationEvent(`console: ${text.slice(0, 200)}`);
	});
	const pageErrors: string[] = [];
	let lastPing = "none";
	page.on("response", (response) => {
		const token = new URL(response.url()).pathname.split("/").at(-1) ?? "";
		if (Buffer.from(token, "base64url").toString("utf8").includes("pingFn")) lastPing = `${response.status()} at ${new Date().toISOString()}`;
	});
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
	const cacheRoot = join(dir, ".vite-cache");
	const metadataFile = readdirSync(cacheRoot).map((name) => join(cacheRoot, name, "deps", "_metadata.json")).find(existsSync);
	if (!metadataFile) throw new Error("Vite optimizer metadata is missing after the initial page load");
	const optimized = (JSON.parse(readFileSync(metadataFile, "utf8")) as { optimized?: Record<string, unknown> }).optimized ?? {};
	if (!("react-markdown" in optimized) || !("remark-gfm" in optimized)) throw new Error("Markdown dependencies were not optimized on initial load");
	step("login link → page renders MCP data, Tailwind classes, recharts and theme.css");
	let failCode = true;
	await page.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (failCode && Buffer.from(token, "base64url").toString("utf8").includes("getCodeFn")) {
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
		} else await route.continue();
	});
	await page.getByRole("tab", { name: "Code" }).click();
	await page.getByText("Could not read the source").waitFor({ timeout: 15000 });
	failCode = false;
	await page.getByRole("button", { name: "Retry" }).click();
	await page.locator("pre").filter({ hasText: "export default function McpDemo" }).waitFor({ timeout: 10000 });
	await page.setViewportSize({ width: 320, height: 700 });
	const sourceRegion = page.getByRole("region", { name: "Artifact source code" });
	await sourceRegion.focus({ timeout: 5000 });
	await page.keyboard.press("ArrowRight");
	await page.waitForFunction(() => (document.querySelector('[aria-label="Artifact source code"]') as HTMLElement | null)?.scrollLeft! > 0, undefined, { timeout: 5000 });
	await page.setViewportSize({ width: 1100, height: 650 });
	await page.unrouteAll({ behavior: "wait" });
	await page.getByRole("tab", { name: "Preview" }).click();
	await page.getByText("★ 1234").waitFor({ timeout: 10000 });
	step("artifact source is readable from the Code tab");

	const originalArtifactUrl = page.url();
	let failGalleryLoad = true;
	await page.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (failGalleryLoad && Buffer.from(token, "base64url").toString("utf8").includes("listArtifactsFn")) {
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
		} else await route.continue();
	});
	await page.getByRole("link", { name: "All artifacts" }).click();
	await page.getByText("Could not load artifacts").waitFor({ timeout: 10000 });
	failGalleryLoad = false;
	await page.getByRole("button", { name: "Retry" }).click();
	await page.getByRole("heading", { name: "pi artifacts" }).waitFor({ timeout: 10000 });
	const gallerySearch = page.getByRole("textbox", { name: "Search artifacts", exact: true });
	await gallerySearch.fill("no-such-artifact", { timeout: 5000 });
	await page.getByText('No artifacts match “no-such-artifact”.').waitFor({ timeout: 10000 });
	await page.getByRole("status").filter({ hasText: "0 artifacts found" }).waitFor({ state: "attached", timeout: 5000 });
	await gallerySearch.fill("MCP demo");
	await page.getByRole("status").filter({ hasText: "1 artifact found" }).waitFor({ state: "attached", timeout: 5000 });
	await gallerySearch.clear();
	await page.getByRole("link", { name: /MCP demo/ }).waitFor({ timeout: 10000 });
	await page.unrouteAll({ behavior: "wait" });
	let failArtifactLoad = true;
	await page.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (failArtifactLoad && Buffer.from(token, "base64url").toString("utf8").includes("getArtifactFn")) {
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
		} else await route.continue();
	});
	recordNavigationEvent("stage: load artifact with injected failure");
	await page.goto(originalArtifactUrl);
	await page.getByText("Could not load the artifact").waitFor({ timeout: 10000 });
	failArtifactLoad = false;
	await page.getByRole("button", { name: "Retry" }).click({ timeout: 5000 });
	await page.getByText("★ 1234").waitFor({ timeout: 10000 });
	await page.unrouteAll({ behavior: "wait" });
	let failTemplateLoad = true;
	await page.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (failTemplateLoad && Buffer.from(token, "base64url").toString("utf8").includes("getTemplatePreviewFn")) {
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
		} else await route.continue();
	});
	await page.goto(new URL("/t/dashboard", originalArtifactUrl).href);
	await page.getByText("Could not load the template").waitFor({ timeout: 10000 });
	failTemplateLoad = false;
	await page.getByRole("button", { name: "Retry" }).click({ timeout: 5000 });
	await page.getByRole("heading", { name: "Template: KPI dashboard" }).waitFor({ timeout: 10000 });
	await page.unrouteAll({ behavior: "wait" });
	for (const [path, message] of [["/a/does-not-exist", "Could not load the artifact"], ["/t/does-not-exist", "Could not load the template"]]) {
		await page.goto(new URL(path, originalArtifactUrl).href);
		await page.getByText(message).waitFor({ timeout: 10000 });
		await page.getByRole("link", { name: "All artifacts" }).click({ timeout: 5000 });
		await page.getByRole("heading", { name: "pi artifacts" }).waitFor({ timeout: 10000 });
	}
	recordNavigationEvent("stage: return to artifact after missing routes");
	await page.goto(originalArtifactUrl);
	await page.getByText("★ 1234").waitFor({ timeout: 10000 });
	step("artifact and template errors support retry and link back to the gallery");
	if (process.env.E2E_NAVIGATION_STRESS === "1") {
		for (let attempt = 0; attempt < 30; attempt++) {
			recordNavigationEvent(`stage: stress missing route ${attempt + 1}`);
			const [path, message] = attempt % 2 === 0
				? ["/a/does-not-exist", "Could not load the artifact"]
				: ["/t/does-not-exist", "Could not load the template"];
			await page.goto(new URL(path, originalArtifactUrl).href);
			await page.getByText(message).waitFor({ timeout: 10000 });
			await page.getByRole("link", { name: "All artifacts" }).click({ timeout: 5000 });
			await page.getByRole("heading", { name: "pi artifacts" }).waitFor({ timeout: 10000 });
			recordNavigationEvent(`stage: stress return to artifact ${attempt + 1}`);
			await page.goto(originalArtifactUrl);
			await page.getByText("★ 1234").waitFor({ timeout: 10000 });
		}
		step("repeated navigation after missing routes");
		console.log("Navigation reload diagnostics:", JSON.stringify(Object.fromEntries(reloadCounts)));
	}

	// A subagent can inspect an artifact, then give its parent a fresh one-use link.
	const metaBeforeLink = readFileSync(join(dir, id, "meta.json"), "utf8");
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_link", { id })), fauxAssistantMessage("ok")]);
	await first.prompt("Get a fresh link for the parent");
	const freshLink = first.lastResult("artifact_link");
	if (freshLink.isError) throw new Error(freshLink.text);
	const parentContext = await browser.newContext();
	const parentPage = await parentContext.newPage();
	await parentPage.goto(openLink(freshLink.text), { waitUntil: "networkidle" });
	await parentPage.getByText("★ 1234").waitFor({ timeout: 30000 });
	await parentContext.close();
	if (readFileSync(join(dir, id, "meta.json"), "utf8") !== metaBeforeLink) throw new Error("getting a link changed the artifact");
	step("fresh artifact link works in another browser context without rewriting");

	first.respond([fauxAssistantMessage(fauxToolCall("artifact_link", { id })), fauxAssistantMessage("ok")]);
	await first.prompt("Open a status check");
	const statusPage = await browser.newPage();
	let releaseStatus!: () => void;
	let statusStarted!: () => void;
	const statusGate = new Promise<void>((resolve) => { releaseStatus = resolve; });
	const statusRequest = new Promise<void>((resolve) => { statusStarted = resolve; });
	await statusPage.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (Buffer.from(token, "base64url").toString("utf8").includes("mcpStatusFn")) {
			statusStarted();
			await statusGate;
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
		} else await route.continue();
	});
	try {
		await statusPage.goto(openLink(first.lastResult("artifact_link").text), { waitUntil: "domcontentloaded" });
		await Promise.race([statusRequest, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("status request did not start")), 10000))]);
		await statusPage.getByText("pi checking").waitFor({ timeout: 3000 });
		releaseStatus();
		await statusPage.getByText("pi status unavailable").waitFor({ timeout: 10000 });
	} finally {
		releaseStatus();
		await statusPage.unrouteAll({ behavior: "wait" });
		await statusPage.close();
	}
	step("MCP status distinguishes checking and unavailable from offline");

	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", {
		id: "mcp-no-retry", title: "MCP retry", mcp: ["echo.stats"],
		code: 'import { useMcp } from "@pi/artifact"; export default function RetryCheck() { const q = useMcp("echo.stats"); return <p>{q.error ? "Request failed" : "Loading"}</p>; }',
	})), fauxAssistantMessage("ok")]);
	await first.prompt("Create an MCP retry check");
	const retryPage = await browser.newPage();
	let mcpAttempts = 0;
	await retryPage.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (Buffer.from(token, "base64url").toString("utf8").includes("mcpCallFn")) {
			mcpAttempts++;
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
		} else await route.continue();
	});
	await retryPage.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "domcontentloaded" });
	await retryPage.getByText("Request failed").waitFor({ timeout: 15000 });
	if (mcpAttempts !== 1) throw new Error(`MCP query retried automatically ${mcpAttempts} times`);
	await retryPage.close();
	step("MCP query failures are not retried automatically");

	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", {
		id: "mcp-explicit-retry", title: "MCP explicit retry", mcp: ["echo.stats"],
		code: 'import { useMcp } from "@pi/artifact"; export default function ExplicitRetry() { const q = useMcp("echo.stats", {}, { retry: 1, retryDelay: 0 }); return <p>{q.error ? "Retry failed" : "Loading"}</p>; }',
	})), fauxAssistantMessage("ok")]);
	await first.prompt("Create an explicitly retrying MCP query");
	const optInPage = await browser.newPage();
	let optInAttempts = 0;
	await optInPage.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (Buffer.from(token, "base64url").toString("utf8").includes("mcpCallFn")) {
			optInAttempts++;
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
		} else await route.continue();
	});
	await optInPage.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "domcontentloaded" });
	await optInPage.getByText("Retry failed").waitFor({ timeout: 15000 });
	if (optInAttempts !== 2) throw new Error(`Explicit MCP retry sent ${optInAttempts} requests`);
	await optInPage.close();
	step("MCP queries can opt in to retries for safe tools");

	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", {
		id: "mcp-empty-check", title: "MCP empty check", mcp: ["echo.stats"],
		code: 'import { McpQuery } from "@/components/blocks"; export default function EmptyCheck() { return <><McpQuery tool="echo.stats" select={() => []} isEmpty={() => false}>{(items) => <p>Valid empty {items.length}</p>}</McpQuery><McpQuery tool="echo.stats" select={() => []} empty={<p>Default empty</p>}>{() => <p>Unexpected content</p>}</McpQuery><McpQuery tool="echo.stats" select={() => { throw new Error("selection failed"); }}>{() => <p>Unexpected selection</p>}</McpQuery><McpQuery tool="echo.stats" isEmpty={() => { throw new Error("empty check failed"); }}>{() => <p>Unexpected check</p>}</McpQuery></>; }',
	})), fauxAssistantMessage("ok")]);
	await first.prompt("Create a custom empty-state check");
	const emptyPage = await browser.newPage();
	await emptyPage.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "networkidle" });
	await emptyPage.getByText("Valid empty 0").waitFor({ timeout: 10000 });
	await emptyPage.getByText("Default empty").waitFor({ timeout: 10000 });
	await emptyPage.getByText("selection failed").waitFor({ timeout: 10000 });
	await emptyPage.getByText("empty check failed").waitFor({ timeout: 10000 });
	for (const message of ["selection failed", "empty check failed"]) {
		if (await emptyPage.getByRole("alert").filter({ hasText: message }).getByRole("button", { name: "Retry" }).count()) throw new Error(`local callback error offers an MCP retry: ${message}`);
	}
	await emptyPage.close();
	step("MCP query honors custom empty-state decisions and isolates callback errors");

	const scalarCode = 'import { useMcp } from "@pi/artifact"; function Value({ text }) { const q = useMcp("echo.scalar", { text }); return <p data-testid={text}>{q.data ? `${typeof q.data.data}:${JSON.stringify(q.data.data)}|${q.data.text}` : "loading"}</p>; } export default function Scalars() { return <><Value text="42" /><Value text="false" /><Value text="null" /><Value text={\'"hello"\'} /><Value text="plain text" /><Value text="1e400" /><Value text="1e-400" /><Value text="9007199254740993" /></>; }';
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "mcp-scalars", title: "MCP scalar values", code: scalarCode, mcp: ["echo.scalar"] })), fauxAssistantMessage("ok")]);
	await first.prompt("Create an MCP scalar check");
	const scalarLive = await browser.newPage();
	await scalarLive.goto(openLink(first.lastResult("artifact_write").text));
	const scalarExpectations = [["42", "number:42"], ["false", "boolean:false"], ["null", "object:null"], ['"hello"', 'string:"hello"'], ["plain text", "undefined:undefined|plain text"], ["1e400", "undefined:undefined|1e400"], ["1e-400", "undefined:undefined|1e-400"], ["9007199254740993", "undefined:undefined|9007199254740993"]];
	for (const [id, expected] of scalarExpectations) await scalarLive.getByTestId(id).filter({ hasText: expected }).waitFor({ timeout: 15000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "mcp-scalars", path: "mcp-scalars.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the MCP scalar check");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	const scalarOffline = await browser.newPage();
	await scalarOffline.goto(pathToFileURL(join(first.cwd, "mcp-scalars.html")).href);
	for (const [id, expected] of scalarExpectations) await scalarOffline.getByTestId(id).filter({ hasText: expected }).waitFor({ timeout: 10000 });
	await scalarOffline.close();
	await scalarLive.close();
	step("MCP JSON scalars preserve their types live and offline");

	const failureCode = 'import { useMcp } from "@pi/artifact"; export default function Failure() { const q = useMcp("echo.failure"); return <p>{q.error ? `error: ${q.error.message}` : q.isPending ? "loading" : "unexpected success"}</p>; }';
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "mcp-tool-error", title: "MCP error", code: failureCode, mcp: ["echo.failure"] })), fauxAssistantMessage("ok")]);
	await first.prompt("Create an MCP error check");
	const toolErrorPage = await browser.newPage();
	await toolErrorPage.goto(openLink(first.lastResult("artifact_write").text));
	await toolErrorPage.getByText("error: deliberate MCP failure").waitFor({ timeout: 15000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "mcp-tool-error", path: "mcp-tool-error.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the MCP error check");
	const toolErrorExport = first.lastResult("artifact_export");
	if (toolErrorExport.isError || !toolErrorExport.text.includes("0 MCP result")) throw new Error(`failed MCP result was exported: ${toolErrorExport.text}`);
	await toolErrorPage.close();
	step("MCP tool errors are displayed and excluded from exports");

	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_write", { id: "route-b", title: "Route B", code: 'import { useState } from "react"; export default function RouteB() { const [n, setN] = useState(0); return <button data-testid="route-b" onClick={() => setN(n + 1)}>Artifact B {n}</button>; }' })),
		fauxAssistantMessage(fauxToolCall("artifact_write", { id: "route-a", title: "Route A", code: 'import { Link } from "@tanstack/react-router"; export default function RouteA() { return <><p data-testid="route-a">Artifact A</p><Link to="/a/$id" params={{ id: "route-b" }}>Go to B</Link></>; }' })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Create two linked artifacts");
	const routePage = await browser.newPage();
	await routePage.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "networkidle" });
	await routePage.getByTestId("route-a").waitFor({ timeout: 10000 });
	let releaseRoute!: () => void;
	let requestedRoute!: () => void;
	const routeGate = new Promise<void>((resolve) => { releaseRoute = resolve; });
	const routeRequested = new Promise<void>((resolve) => { requestedRoute = resolve; });
	await routePage.route("**/route-b/index.tsx*", async (route) => { requestedRoute(); await routeGate; await route.continue(); });
	try {
		await routePage.getByRole("link", { name: "Go to B" }).click({ noWaitAfter: true });
		await Promise.race([routeRequested, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("target module was not requested")), 10000))]);
		if (await routePage.getByTestId("route-a").count()) throw new Error("previous artifact remained visible while the new module loaded");
	} finally {
		releaseRoute();
		await routePage.unrouteAll({ behavior: "wait" });
	}
	await routePage.getByTestId("route-b").waitFor({ timeout: 10000 });
	await routePage.getByTestId("route-b").click();
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "route-b", title: "Route B", code: 'import { useState } from "react"; export default function RouteB() { const [n, setN] = useState(0); return <button data-testid="route-b" onClick={() => setN(n + 1)}>Updated B {n}</button>; }' })), fauxAssistantMessage("ok")]);
	await first.prompt("Update the second linked artifact");
	if (first.lastResult("artifact_write").isError) throw new Error(first.lastResult("artifact_write").text);
	await routePage.getByTestId("route-b").filter({ hasText: "Updated B 1" }).waitFor({ timeout: 10000 });
	await routePage.close();
	step("route changes avoid stale content and hot reload preserves component state");

	// A nested module fails before the browser asks for it, so artifact_write must report it.
	const nestedErrorDir = join(dir, "nested-compile-error");
	mkdirSync(nestedErrorDir, { recursive: true });
	writeFileSync(join(nestedErrorDir, "helper.ts"), 'export { broken } from "./nested";');
	writeFileSync(join(nestedErrorDir, "nested.ts"), "export const broken = ;");
	const nestedCode = 'import { broken } from "./helper"; export default function Demo() { return <p>{broken}</p>; }';
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "nested-compile-error", title: "Nested compile error", code: nestedCode })), fauxAssistantMessage("ok")]);
	await first.prompt("Create an artifact with an invalid helper");
	const nestedError = first.lastResult("artifact_write");
	if (!nestedError.isError || !nestedError.text.includes("nested.ts")) throw new Error("artifact_write did not report the nested module compile error");
	// A valid cycle must terminate the dependency walk after the error is fixed.
	writeFileSync(join(nestedErrorDir, "nested.ts"), 'import "./helper"; export const broken = "fixed";');
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "nested-compile-error", title: "Nested compile error", code: nestedCode })), fauxAssistantMessage("ok")]);
	await first.prompt("Fix the invalid helper and rewrite the artifact");
	if (first.lastResult("artifact_write").isError) throw new Error("artifact_write did not clear the fixed nested compile error");
	step("artifact_write reports local dependency errors and accepts a fixed cycle");

	// Relative source, stylesheet and asset imports must work even if the root has URL delimiters.
	const relativeDir = join(dir, "relative-demo");
	mkdirSync(relativeDir, { recursive: true });
	const relativeSecretDir = temporaryDir("pi-relative-secret-");
	writeFileSync(join(relativeSecretDir, "secret.txt"), "RELATIVE_PRIVATE_MARKER");
	symlinkSync(join(relativeSecretDir, "secret.txt"), join(relativeDir, "leak.txt"), "file");
	writeFileSync(join(relativeDir, "helper.ts"), 'export const label = "first";');
	writeFileSync(join(relativeDir, "info.json"), '{"number":42}');
	writeFileSync(join(relativeDir, "notes.md"), "# Local Markdown\n\nSnapshot content.");
	writeFileSync(join(relativeDir, "more.css"), ".relative-test { color: rgb(1, 2, 3); }");
	writeFileSync(join(relativeDir, "style.css"), '@import "./more.css"; .relative-test { font-size: 31px; background-image: url("./icon.svg"); }');
	writeFileSync(join(relativeDir, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>');
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "relative-demo", title: "Relative demo", code: 'import { label } from "./helper"; import info from "./info.json"; import notes from "./notes.md?raw"; import { Markdown } from "@/components/blocks"; import "./style.css"; import icon from "./icon.svg"; export default function RelativeDemo() { return <><p className="relative-test">{label} {info.number}</p><Markdown>{notes}</Markdown><img alt="icon" src={icon} /></>; }' })), fauxAssistantMessage("ok")]);
	await first.prompt("Create an artifact with relative files");
	const relativeWrite = first.lastResult("artifact_write");
	if (relativeWrite.isError) throw new Error(`relative import failed: ${relativeWrite.text}`);
	const relativePage = await browser.newPage();
	await relativePage.goto(openLink(relativeWrite.text), { waitUntil: "networkidle" });
	const relativeText = relativePage.getByText("first 42", { exact: true });
	await relativeText.waitFor({ timeout: 10000 });
	await relativePage.getByRole("heading", { name: "Local Markdown" }).waitFor({ timeout: 10000 });
	const relativeStyle = await relativeText.evaluate((element) => ({ size: getComputedStyle(element).fontSize, color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundImage }));
	if (relativeStyle.size !== "31px" || relativeStyle.color !== "rgb(1, 2, 3)" || !relativeStyle.background.includes("image/svg+xml")) throw new Error(`relative CSS did not load: ${JSON.stringify(relativeStyle)}`);
	await relativePage.waitForFunction(() => (document.querySelector('img[alt="icon"]') as HTMLImageElement | null)?.naturalWidth === 4, undefined, { timeout: 10000 });
	const moduleRequest = await relativePage.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).find((url) => new URL(url).pathname.endsWith("/relative-demo/index.tsx")));
	if (!moduleRequest) throw new Error("could not find the artifact module request");
	const leakPath = new URL(moduleRequest).pathname.replace(/index\.tsx$/, "leak.txt") + "?raw";
	const leakResponse = await relativePage.evaluate(async (path) => { const response = await fetch(path); return { status: response.status, text: await response.text() }; }, leakPath);
	if (leakResponse.status < 400 || leakResponse.text.includes("RELATIVE_PRIVATE_MARKER")) throw new Error("alias allowed a direct symlink escape");
	for (const shared of ["root-shared.ts", "_shared/helper.ts", ".vite-cache/shared.js"]) {
		const sharedPath = join(dir, shared);
		mkdirSync(dirname(sharedPath), { recursive: true });
		writeFileSync(sharedPath, `import secret from ${JSON.stringify(`${join(relativeSecretDir, "secret.txt")}?raw`)}; export { secret };`);
		const response = await relativePage.evaluate(async (url) => { const r = await fetch(url); return { status: r.status, text: await r.text() }; }, fsUrl(sharedPath));
		if (response.status < 400 || response.text.includes("RELATIVE_PRIVATE_MARKER")) throw new Error("viewer allowed shared code to load a file outside allowed roots");
	}
	step("shared code cannot import files outside the viewer roots");
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "cache-import", title: "Cache import", code: 'import { secret } from "../.vite-cache/shared.js"; export default function Demo() { return <p>{secret}</p>; }' })), fauxAssistantMessage("ok")]);
	await first.prompt("Create an artifact importing cache code with an external dependency");
	const blockedCache = first.lastResult("artifact_write");
	if (!blockedCache.isError || !blockedCache.text.includes("outside the allowed viewer roots")) throw new Error("artifact_write did not report the cache dependency error");
	const optimizerRoot = join(dir, ".vite-cache");
	const optimizer = readdirSync(optimizerRoot).find((name) => existsSync(join(optimizerRoot, name, "deps")));
	if (!optimizer) throw new Error("optimizer cache was not created");
	const optimizerFile = join(optimizerRoot, optimizer, "deps", "guard-probe.js");
	writeFileSync(optimizerFile, `import secret from ${JSON.stringify(`${join(relativeSecretDir, "secret.txt")}?raw`)}; export { secret };`);
	const optimizerImport = `../.vite-cache/${optimizer}/deps/guard-probe.js`;
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "optimizer-import", title: "Optimizer import", code: `import { secret } from ${JSON.stringify(optimizerImport)}; export default function Demo() { return <p>{secret}</p>; }` })), fauxAssistantMessage("ok")]);
	await first.prompt("Create an artifact importing unknown code from the optimizer cache");
	const blockedOptimizer = first.lastResult("artifact_write");
	if (!blockedOptimizer.isError || !blockedOptimizer.text.includes("outside the allowed viewer roots")) throw new Error("artifact_write did not report the unknown optimizer-cache dependency error");
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "shared-import", title: "Shared import", code: 'import { secret } from "../root-shared.ts"; export default function Demo() { return <p>{secret}</p>; }' })), fauxAssistantMessage("ok")]);
	await first.prompt("Create an artifact importing shared code with an external dependency");
	const blockedShared = first.lastResult("artifact_write");
	if (!blockedShared.isError || !blockedShared.text.includes("outside the allowed viewer roots")) throw new Error("artifact_write did not report the shared dependency error");
	writeFileSync(join(dir, "root-shared.ts"), 'export const secret = "shared-ok";');
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "shared-import", title: "Shared import", code: 'import { secret } from "../root-shared.ts"; export default function Demo() { return <p>{secret}</p>; }' })), fauxAssistantMessage("ok")]);
	await first.prompt("Replace the shared dependency with allowed content");
	if (first.lastResult("artifact_write").isError) throw new Error("artifact_write did not accept the fixed shared dependency");
	step("artifact_write checks shared dependencies and accepts them after correction");
	const blockedImport = JSON.stringify(`${join(relativeSecretDir, "secret.txt")}?raw`);
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "external-import", title: "External import", code: `import text from ${blockedImport}; export default function Demo() { return <p>{text}</p>; }` })), fauxAssistantMessage("ok")]);
	await first.prompt("Create an artifact importing an external file");
	const blockedWrite = first.lastResult("artifact_write");
	if (!blockedWrite.isError || !blockedWrite.text.includes("outside the allowed viewer roots") || !blockedWrite.text.includes("copy it into the artifact directory")) {
		throw new Error(`external import did not produce actionable compile error: ${blockedWrite.text}`);
	}
	if (blockedWrite.text.includes("RELATIVE_PRIVATE_MARKER")) throw new Error("external import exposed private content in compile error");
	step("external imports return actionable compile errors without exposing file contents");
	removeTemporaryDir(relativeSecretDir);
	writeFileSync(join(relativeDir, "helper.ts"), 'export const label = "second";');
	await relativePage.getByText("second 42", { exact: true }).waitFor({ timeout: 10000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "relative-demo", path: "relative-demo.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the relative-file artifact");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	const relativeOffline = await browser.newPage();
	const relativeRequests: string[] = [];
	relativeOffline.on("request", (request) => { if (!/^(file|data|blob):/.test(request.url())) relativeRequests.push(request.url()); });
	await relativeOffline.goto(pathToFileURL(join(first.cwd, "relative-demo.html")).href);
	const relativeOfflineText = relativeOffline.getByText("second 42", { exact: true });
	await relativeOfflineText.waitFor({ timeout: 10000 });
	await relativeOffline.getByRole("heading", { name: "Local Markdown" }).waitFor({ timeout: 10000 });
	const offlineStyle = await relativeOfflineText.evaluate((element) => ({ size: getComputedStyle(element).fontSize, color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundImage }));
	if (offlineStyle.size !== "31px" || offlineStyle.color !== "rgb(1, 2, 3)" || !offlineStyle.background.includes("image/svg+xml")) throw new Error(`offline relative CSS did not load: ${JSON.stringify(offlineStyle)}`);
	await relativeOffline.waitForFunction(() => (document.querySelector('img[alt="icon"]') as HTMLImageElement | null)?.naturalWidth === 4, undefined, { timeout: 10000 });
	if (relativeRequests.length) throw new Error(`relative export made network requests: ${relativeRequests}`);
	await relativeOffline.close();
	await relativePage.close();
	step("relative TS, JSON, Markdown, CSS and images work in viewer and offline export");

	// A set of Markdown snapshots can navigate among documents without network access.
	const docsCode = `import { MarkdownDocuments } from "@/components/blocks";
		const documents = [
			{ path: "index.md", title: "Overview", content: "# Overview\\n\\n[Read design](docs/%E8%A8%AD%E8%A8%88.md)\\n\\n[Read details](docs/%E8%A8%AD%E8%A8%88.md#details)\\n\\n[Missing section](docs/%E8%A8%AD%E8%A8%88.md#absent)\\n\\n[Special](docs/plan%231%3F.md)\\n\\n[Missing](missing.md)\\n\\n[Missing Japanese](docs/${encodeURIComponent("未収録.md")})\\n\\n[Website](https://example.com)" },
			{ path: "docs/設計.md", title: "Design " + "x".repeat(120), content: "# Design document\\n\\n## Details\\n\\n[Return](../index.md)" },
			{ path: "docs/plan#1?.md", title: "Special", content: "# Special document\\n\\n[Return](../index.md)" },
		];
		export default function Documents() { return <MarkdownDocuments documents={documents} />; }`;
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "markdown-documents", title: "Documents", code: docsCode })), fauxAssistantMessage("ok")]);
	await first.prompt("Create linked Markdown documents");
	const docsWrite = first.lastResult("artifact_write");
	if (docsWrite.isError) throw new Error(`Markdown documents did not compile: ${docsWrite.text}`);
	const docsPage = await browser.newPage();
	await docsPage.setViewportSize({ width: 375, height: 650 });
	await docsPage.goto(openLink(docsWrite.text));
	await docsPage.getByRole("heading", { name: "Overview" }).waitFor();
	if (await docsPage.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Markdown document selector overflows a narrow viewport");
	await docsPage.getByLabel("Document", { exact: true }).selectOption("docs/設計.md");
	await docsPage.getByRole("heading", { name: "Design document" }).waitFor();
	await docsPage.getByLabel("Document", { exact: true }).selectOption("index.md");
	await docsPage.getByRole("button", { name: "Read design" }).click();
	await docsPage.getByRole("heading", { name: "Design document" }).waitFor();
	await docsPage.waitForFunction(() => document.activeElement?.textContent === "Design document");
	await docsPage.getByRole("button", { name: "Return" }).click();
	await docsPage.getByRole("button", { name: "Special" }).click();
	await docsPage.getByRole("heading", { name: "Special document" }).waitFor();
	await docsPage.getByRole("button", { name: "Return" }).click();
	await docsPage.getByRole("button", { name: "Read details" }).click();
	await docsPage.getByRole("heading", { name: "Details" }).waitFor();
	await docsPage.waitForFunction(() => document.activeElement?.textContent === "Details");
	await docsPage.getByRole("button", { name: "Return" }).click();
	await docsPage.getByRole("button", { name: "Missing section" }).click();
	await docsPage.getByRole("status").getByText(/section was not found/i).waitFor();
	await docsPage.waitForFunction(() => document.activeElement?.textContent === "Design document");
	await docsPage.getByRole("button", { name: "Return" }).click();
	await docsPage.getByRole("button", { name: "Missing", exact: true }).click();
	await docsPage.getByRole("status").getByText(/not included: missing\.md/i).waitFor();
	await docsPage.waitForFunction(() => document.activeElement?.textContent === "Missing");
	await docsPage.getByRole("button", { name: "Missing Japanese", exact: true }).click();
	await docsPage.getByRole("status").getByText(/not included: docs\/未収録\.md/i).waitFor();
	if (await docsPage.getByRole("link", { name: "Website" }).getAttribute("href") !== "https://example.com") throw new Error("external Markdown link changed");
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "markdown-documents", path: "markdown-documents.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the linked Markdown documents");
	if (first.lastResult("artifact_export").isError) throw new Error("linked Markdown export failed");
	const docsOffline = await browser.newPage();
	const docsRequests: string[] = [];
	docsOffline.on("request", (request) => { if (!/^(file|data|blob):/.test(request.url())) docsRequests.push(request.url()); });
	await docsOffline.goto(pathToFileURL(join(first.cwd, "markdown-documents.html")).href);
	await docsOffline.getByRole("button", { name: "Read design" }).click();
	await docsOffline.getByRole("heading", { name: "Design document" }).waitFor();
	await docsOffline.waitForFunction(() => document.activeElement?.textContent === "Design document");
	await docsOffline.getByRole("button", { name: "Return" }).click();
	await docsOffline.getByRole("button", { name: "Read details" }).click();
	await docsOffline.waitForFunction(() => document.activeElement?.textContent === "Details");
	await docsOffline.getByRole("button", { name: "Return" }).click();
	await docsOffline.getByRole("button", { name: "Missing", exact: true }).click();
	await docsOffline.getByRole("status").getByText(/not included: missing\.md/i).waitFor();
	if (docsRequests.length) throw new Error(`Markdown document export made network requests: ${docsRequests}`);
	await docsOffline.close();
	await docsPage.close();
	step("linked Markdown documents navigate in the viewer and offline export");

	// Artifacts (any script in the page) cannot read real files outside the viewer's roots:
	// next to the package (e.g. a home folder holding a checkout), in temp, or daemon state.
	// (When installed, the package's parent is the dependency folder, which is served on
	// purpose; probe the folder that holds it instead.)
	const parent = basename(dirname(PACKAGE)) === "node_modules" ? dirname(dirname(PACKAGE)) : dirname(PACKAGE);
	const besidePackage = join(parent, `.pi-artifacts-probe-${process.pid}.txt`);
	const probeDir = temporaryDir("pi-probe-");
	const inTemp = join(probeDir, "secret.txt");
	let createdBesidePackage = false;
	try {
		writeFileSync(besidePackage, "secret", { flag: "wx" });
		createdBesidePackage = true;
		writeFileSync(inTemp, "secret");
		const outside = await page.evaluate(async (paths) => {
			const out: Record<string, number> = {};
			for (const p of paths) out[p] = (await fetch(`/@fs${encodeURI(p).replaceAll("#", "%23").replaceAll("?", "%3F")}`)).status;
			return out;
		}, [besidePackage, inTemp, join(dir, ".state", "memory.sqlite"), join(dir, ".state", "viewer.json")]);
		if (Object.entries(outside).some(([path, status]) => status !== 403 && !(status === 404 && /[#?%]/.test(path)))) {
			throw new Error(`readable outside the allow list: ${JSON.stringify(outside)}`);
		}
	} finally {
		if (createdBesidePackage) rmSync(besidePackage, { force: true });
		removeTemporaryDir(probeDir);
	}
	step("/@fs outside the viewer, artifacts and templates is refused");

	if (customTemplates && process.env.PI_ARTIFACTS_TEMPLATES && !/[#?%]/.test(process.env.PI_ARTIFACTS_TEMPLATES)) {
		const templateRoot = process.env.PI_ARTIFACTS_TEMPLATES;
		const outsideDir = temporaryDir("pi-other-root-secret-");
		const link = join(templateRoot, `pi-outside-link-${process.pid}.txt`);
		writeFileSync(join(outsideDir, "secret.txt"), "OTHER_ROOT_PRIVATE_MARKER");
		symlinkSync(join(outsideDir, "secret.txt"), link, "file");
		try {
			const response = await page.evaluate(async (url) => { const r = await fetch(url); return { status: r.status, text: await r.text() }; }, `${fsUrl(link)}?raw`);
			if (response.status < 400 || response.text.includes("OTHER_ROOT_PRIVATE_MARKER")) throw new Error("symlink from another allowed root escaped the filesystem policy");
		} finally {
			rmSync(link, { force: true });
			removeTemporaryDir(outsideDir);
		}
		step("other allowed roots cannot expose outside files through symlinks");
	}


	await page.getByRole("button", { name: "Reverse" }).click();
	await page.getByTestId("history").getByText("ip olleh").waitFor({ timeout: 20000 });
	await page.waitForTimeout(500);
	await page.screenshot({ path: process.env.E2E_SCREENSHOT ?? join(tmpdir(), "pi-artifacts-e2e.png") });
	await page.reload({ waitUntil: "networkidle" });
	await page.getByTestId("history").getByText("ip olleh").waitFor({ timeout: 20000 });
	step("MCP mutation + SQLite memory survive a reload");

	// The content blocks must also survive a standalone export, including Markdown's dependencies.
	const plan = readFileSync(join(PACKAGE, "skills/artifacts/templates/project-plan/template.tsx"), "utf8");
	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_write", { id: "project-plan", title: "Project plan", code: plan })),
		fauxAssistantMessage(fauxToolCall("artifact_export", { id: "project-plan", path: "project-plan.html" })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Export a project plan");
	if (first.lastResult("artifact_write").isError || first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	const planPage = await browser.newPage();
	const planRequests: string[] = [];
	planPage.on("request", (r: { url(): string }) => !/^(file|data|blob):/.test(r.url()) && planRequests.push(r.url()));
	await planPage.goto(pathToFileURL(join(first.cwd, "project-plan.html")).href);
	await planPage.getByRole("region", { name: "Gantt chart" }).getByText("Discovery").waitFor({ timeout: 10000 });
	await planPage.getByRole("heading", { name: "Project brief" }).waitFor({ timeout: 10000 });
	await planPage.getByRole("checkbox", { name: "Agree on the project scope", checked: true }).waitFor({ timeout: 10000 });
	if (planRequests.length) throw new Error(`project plan export made network requests: ${planRequests}`);
	await planPage.close();
	step("Gantt and Markdown blocks render in an offline export");

	const wideMarkdown = `| ${Array.from({ length: 10 }, (_, i) => `Column ${i + 1}`).join(" | ")} |\n| ${Array(10).fill("---").join(" | ")} |\n| ${Array(10).fill("content").join(" | ")} |\n\n~~~\n${"long_code_".repeat(30)}\n~~~`;
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "wide-markdown", title: "Wide Markdown", code: `import { Markdown } from "@/components/blocks"; export default function WideMarkdown() { return <Markdown>{${JSON.stringify(wideMarkdown)}}</Markdown>; }` })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a wide Markdown table");
	const markdownPage = await browser.newPage({ viewport: { width: 320, height: 700 } });
	await markdownPage.goto(openLink(first.lastResult("artifact_write").text));
	const markdownTable = markdownPage.getByRole("region", { name: "Markdown table" });
	await markdownTable.focus({ timeout: 5000 });
	await markdownPage.keyboard.press("ArrowRight");
	await markdownPage.waitForFunction(() => (document.querySelector('[aria-label="Markdown table"]') as HTMLElement | null)?.scrollLeft! > 0, undefined, { timeout: 5000 });
	const markdownCode = markdownPage.getByRole("region", { name: "Markdown code block" });
	await markdownCode.focus({ timeout: 5000 });
	await markdownPage.keyboard.press("ArrowRight");
	await markdownPage.waitForFunction(() => (document.querySelector('[aria-label="Markdown code block"]') as HTMLElement | null)?.scrollLeft! > 0, undefined, { timeout: 5000 });
	await markdownPage.close();
	step("wide Markdown tables and code can be scrolled with the keyboard");

	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "weekly-timeline", title: "Weekly timeline", code: 'import { GanttChart } from "@/components/blocks"; export default function Weekly() { return <GanttChart tasks={[{ id: "week", label: "Week", start: "2026-11-01", end: "2026-11-07" }, { id: "long", label: "VeryLongTaskNameWithoutAnySpacesThatMustStayWithinItsColumn", start: "2026-11-01", end: "2026-11-02" }, { id: "invalid-date", label: "Date error", start: "2026-11-05", end: "2026-11-03" }, { id: "invalid-progress", label: "Progress error", start: "2026-11-01", end: "2026-11-02", progress: 150 }]} />; }' })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a weekly timeline");
	const weekPage = await browser.newPage({ viewport: { width: 320, height: 700 } });
	await weekPage.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "networkidle" });
	for (const name of ["Preview", "Code", "Memory"]) await weekPage.getByRole("tab", { name, exact: true }).waitFor({ timeout: 10000 });
	const headerFits = await weekPage.locator("header").evaluate((header) => [...header.querySelectorAll("button, a")].every((element) => {
		const rect = element.getBoundingClientRect();
		return rect.left >= 0 && rect.right <= window.innerWidth;
	}));
	if (!headerFits) throw new Error("viewer header controls overflow a narrow viewport");
	const chart = weekPage.getByRole("region", { name: "Gantt chart" });
	await chart.getByRole("list", { name: "Tasks" }).getByRole("listitem", { name: "Week: 2026-11-01 – 2026-11-07" }).waitFor({ timeout: 10000 });
	const invalidDate = chart.getByRole("listitem", { name: "Date error: Invalid date range: 2026-11-05 – 2026-11-03" });
	await invalidDate.getByText("Invalid date range: 2026-11-05 – 2026-11-03").waitFor({ timeout: 10000 });
	const invalidProgress = chart.getByRole("listitem", { name: "Progress error: 2026-11-01 – 2026-11-02 · Invalid progress: 150" });
	await invalidProgress.getByText(/Invalid progress: 150/).waitFor({ timeout: 10000 });
	if (await invalidProgress.locator(".bg-primary.h-full").count()) throw new Error("invalid progress was shown as a completed bar");
	const longTask = chart.getByText("VeryLongTaskNameWithoutAnySpacesThatMustStayWithinItsColumn");
	const labelFits = await longTask.evaluate((element) => element.scrollWidth <= element.clientWidth);
	if (!labelFits) throw new Error("long task label overflows into the timeline");
	await chart.focus();
	await weekPage.keyboard.press("ArrowRight");
	await weekPage.waitForFunction(() => (document.querySelector('[aria-label="Gantt chart"]') as HTMLElement).scrollLeft > 0, undefined, { timeout: 5000 });
	const ticks = chart.locator('[aria-hidden="true"] span');
	await ticks.first().waitFor({ timeout: 10000 });
	const boxes = await ticks.evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { text: node.textContent, left: r.left, right: r.right }; }));
	for (let i = 1; i < boxes.length; i++) if (boxes[i - 1].right > boxes[i].left) throw new Error(`overlapping timeline labels: ${JSON.stringify(boxes)}`);
	const longMemoryKey = `long-${"key".repeat(100)}`;
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "weekly-timeline", key: longMemoryKey, value: 1 })), fauxAssistantMessage("ok")]);
	await first.prompt("Add a long key for export review");
	await weekPage.setViewportSize({ width: 320, height: 320 });
	let failExport = true;
	await weekPage.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (failExport && Buffer.from(token, "base64url").toString("utf8").includes("exportArtifactFn")) {
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
		} else await route.continue();
	});
	await weekPage.getByRole("button", { name: "Export as HTML" }).click();
	await weekPage.getByRole("alert").filter({ hasText: "Export failed" }).waitFor({ timeout: 10000 });
	failExport = false;
	await weekPage.getByRole("button", { name: "Retry export" }).click();
	await weekPage.getByRole("dialog").getByRole("button", { name: "Download" }).waitFor({ timeout: 20000 });
	const dialogFits = await weekPage.getByRole("dialog").evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return rect.top >= 0 && rect.bottom <= window.innerHeight;
	});
	if (!dialogFits) throw new Error("export review dialog extends beyond the viewport");
	const exportKeys = weekPage.getByRole("list", { name: "Memory keys" });
	await exportKeys.focus();
	await exportKeys.evaluate((element) => { element.scrollTop = 0; });
	await weekPage.keyboard.press("ArrowDown");
	await weekPage.waitForFunction(() => (document.querySelector('[aria-label="Memory keys"]') as HTMLElement | null)?.scrollTop! > 0, undefined, { timeout: 5000 });
	const exportKey = weekPage.getByRole("dialog").getByText(longMemoryKey, { exact: true });
	await exportKey.scrollIntoViewIfNeeded();
	if (!(await exportKey.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return element.scrollWidth <= element.clientWidth && rect.left >= 0 && rect.right <= window.innerWidth;
	}))) throw new Error("export review truncates or clips a long memory key");
	await weekPage.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
	await weekPage.close();
	step("weekly timeline exposes task summaries, supports keyboard scrolling and avoids overlapping labels");

	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "sort-check", title: "Sort check", code: 'import { useState } from "react"; import { DataTable, createColumns, SortHeader } from "@/components/blocks"; const c = createColumns(); const columns = c.columns([c.accessor("name", { header: ({ column }) => <SortHeader column={column}>Name</SortHeader> }), c.display({ id: "action", cell: () => <button onClick={() => document.body.setAttribute("data-inner", "clicked")}>Inner action</button> })]); export default function SortCheck() { const [selected, setSelected] = useState("none"); return <><p data-testid="selected">{selected}</p><DataTable columns={columns} data={[{ name: "Ada" }, { name: "Zoe" }]} initialSort={{ id: "name", desc: true }} onRowClick={(row) => setSelected(row.name)} /></>; }' })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a table sort check");
	const sortPage = await browser.newPage();
	await sortPage.goto(openLink(first.lastResult("artifact_write").text));
	const sortHeader = sortPage.getByRole("columnheader", { name: "Name" });
	await sortHeader.waitFor({ timeout: 10000 });
	if (await sortHeader.getAttribute("aria-sort") !== "descending") throw new Error("initial table sort order is not announced");
	await sortPage.getByRole("button", { name: "Name" }).click();
	if (await sortHeader.getAttribute("aria-sort") === null) await sortPage.getByRole("button", { name: "Name" }).click();
	if (await sortHeader.getAttribute("aria-sort") !== "ascending") throw new Error("changed table sort order is not announced");
	const adaRow = sortPage.getByRole("row").filter({ hasText: "Ada" });
	await adaRow.getByRole("button", { name: "Inner action" }).click();
	if (await sortPage.getByTestId("selected").textContent() !== "none") throw new Error("nested button activated its table row");
	await adaRow.getByRole("button", { name: "Inner action" }).focus();
	await sortPage.keyboard.press("Enter");
	if (await sortPage.getByTestId("selected").textContent() !== "none") throw new Error("keyboard activation of nested button activated its table row");
	await adaRow.focus();
	await sortPage.keyboard.press("Enter");
	await sortPage.getByTestId("selected").filter({ hasText: "Ada" }).waitFor({ timeout: 5000 });
	await sortPage.getByRole("row").filter({ hasText: "Zoe" }).focus();
	await sortPage.keyboard.press("Space");
	await sortPage.getByTestId("selected").filter({ hasText: "Zoe" }).waitFor({ timeout: 5000 });
	await sortPage.close();
	step("data table announces sorting and supports keyboard row actions");

	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "page-shrink", title: "Page shrink", code: 'import { useState } from "react"; import { DataTable, createColumns } from "@/components/blocks"; const c = createColumns(); const columns = c.columns([c.accessor("name", { header: "Name" })]); export default function PageShrink() { const [rows, setRows] = useState([{ name: "Ada" }, { name: "Zoe" }]); const [size, setSize] = useState(1); return <><button onClick={() => setRows([{ name: "Ada" }])}>Remove Zoe</button><button onClick={() => setSize(2)}>Show two</button><button onClick={() => setSize(1)}>Show one</button><DataTable columns={columns} data={rows} pageSize={size} /></>; }' })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a page shrink check");
	const shrinkPage = await browser.newPage();
	await shrinkPage.goto(openLink(first.lastResult("artifact_write").text));
	await shrinkPage.getByRole("button", { name: "Next page" }).click();
	await shrinkPage.getByRole("cell", { name: "Zoe" }).waitFor({ timeout: 10000 });
	await shrinkPage.getByRole("button", { name: "Show two" }).click();
	await shrinkPage.getByRole("cell", { name: "Ada" }).waitFor({ timeout: 5000 });
	await shrinkPage.getByRole("cell", { name: "Zoe" }).waitFor({ timeout: 5000 });
	await shrinkPage.getByRole("button", { name: "Show one" }).click();
	await shrinkPage.getByRole("button", { name: "Next page" }).click();
	await shrinkPage.getByRole("cell", { name: "Zoe" }).waitFor({ timeout: 5000 });
	await shrinkPage.getByRole("button", { name: "Remove Zoe" }).click();
	await shrinkPage.getByRole("cell", { name: "Ada" }).waitFor({ timeout: 5000 });
	await shrinkPage.close();
	step("data table returns to a valid page after rows are removed");

	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_write", { id: "delete-target", title: "Delete target", code: "export default function Target() { return null; }" })),
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "delete-target", key: "saved", value: "before deletion" })),
		fauxAssistantMessage(fauxToolCall("artifact_write", { id: "delete-observer", title: "Delete observer", code: 'import { useMemoryList } from "@pi/artifact"; export default function Observer() { const q = useMemoryList({ scope: "delete-target" }); return <output>{q.isPending ? "loading" : JSON.stringify(q.data)}</output>; }' })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Create a deletion notification check");
	const deletionObserver = await browser.newPage();
	await deletionObserver.goto(openLink(first.lastResult("artifact_write").text));
	await deletionObserver.locator("output").filter({ hasText: "before deletion" }).waitFor({ timeout: 10000 });
	const deletionState = JSON.parse(readFileSync(join(dir, ".state", "viewer.json"), "utf8"));
	const deletionResponse = await fetch(`${deletionState.url}/__pi/api/artifacts/delete`, { method: "POST", headers: { "x-pi-artifacts-secret": deletionState.secret, "content-type": "application/json" }, body: JSON.stringify({ id: "delete-target" }) });
	if (!deletionResponse.ok || !(await deletionResponse.json()).deleted) throw new Error("Could not delete the notification test artifact");
	await deletionObserver.locator("output").filter({ hasText: /^\[\]$/ }).waitFor({ timeout: 10000 });
	await deletionObserver.close();
	step("deleting an artifact refreshes its memory in another open artifact");

	// Writes from the browser should refresh memory lists in this and other tabs.
	const memoryDemo = `import { useMemory, useMemoryList } from "@pi/artifact";
export default function MemoryDemo() {
  const [value, setValue, state] = useMemory("count", 0);
  const list = useMemoryList();
  return <><button onClick={() => setValue(v => v + 1)}>Increment</button><span data-testid="count">{value}</span><p data-testid="error">{state.error ? String(state.error) : ""}</p><p data-testid="list">{JSON.stringify(list.data)}</p></>;
}`;
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "memory-sync", title: "Memory sync", code: memoryDemo })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a memory sync demo");
	const memoryLink = openLink(first.lastResult("artifact_write").text);
	const memoryPage = await browser.newPage();
	const otherPage = await browser.newPage();
	await memoryPage.goto(memoryLink, { waitUntil: "networkidle" });
	// Each browser context needs its own login token.
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "memory-sync", title: "Memory sync", code: memoryDemo })), fauxAssistantMessage("ok")]);
	await first.prompt("Open the memory sync demo again");
	await otherPage.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "networkidle" });
	await memoryPage.getByRole("button", { name: "Increment" }).click();
	await memoryPage.getByTestId("list").filter({ hasText: '"value":1' }).waitFor({ timeout: 10000 });
	await otherPage.getByTestId("list").filter({ hasText: '"value":1' }).waitFor({ timeout: 10000 });
	let writes = 0;
	let unblock!: () => void;
	let secondStarted!: () => void;
	const blocked = new Promise<void>((resolve) => { unblock = resolve; });
	const secondRequest = new Promise<void>((resolve) => { secondStarted = resolve; });
	await memoryPage.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		const name = Buffer.from(token, "base64url").toString("utf8");
		if (name.includes("memoryCompareSetFn") && ++writes === 2) {
			secondStarted();
			await blocked;
		}
		await route.continue();
	});
	try {
		await memoryPage.getByRole("button", { name: "Increment" }).evaluate((button: HTMLElement) => { button.click(); button.click(); });
		await Promise.race([secondRequest, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("second memory write did not start")), 10000))]);
		await memoryPage.waitForTimeout(700);
		const count = await memoryPage.getByTestId("count").textContent();
		if (count !== "3") throw new Error(`pending optimistic value was overwritten: ${count}`);
	} finally {
		unblock();
		await memoryPage.unrouteAll({ behavior: "wait" });
	}
	await memoryPage.getByTestId("list").filter({ hasText: '"value":3' }).waitFor({ timeout: 10000 });
	await memoryPage.close();
	await otherPage.close();
	step("browser memory writes refresh lists in both tabs");

	const concurrentCode = 'import { useMemory, useMemoryList } from "@pi/artifact"; export default function ConcurrentCounter() { const [count, setCount, state] = useMemory("count", 0); const [, setAlpha] = useMemory("alpha", 0); const [, setBeta] = useMemory("beta", 0); const list = useMemoryList(); return <><p data-testid="count">{state.loading ? "loading" : count}</p><p data-testid="list">{JSON.stringify(list.data)}</p><p data-testid="error">{state.error ? String(state.error) : ""}</p><button onClick={() => setCount((n) => n + 1)}>Increment</button><button onClick={() => setAlpha(1)}>Set alpha</button><button onClick={() => setBeta(2)}>Set beta</button></>; }';
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "concurrent-memory", title: "Concurrent memory", code: concurrentCode })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a concurrent memory counter");
	const concurrentContext = await browser.newContext();
	const concurrentFirst = await concurrentContext.newPage();
	await concurrentFirst.goto(openLink(first.lastResult("artifact_write").text));
	const concurrentSecond = await concurrentContext.newPage();
	await concurrentSecond.goto(concurrentFirst.url());
	await concurrentFirst.getByTestId("count").filter({ hasText: "0" }).waitFor({ timeout: 10000 });
	await concurrentSecond.getByTestId("count").filter({ hasText: "0" }).waitFor({ timeout: 10000 });
	let releaseFirstUpdate!: () => void;
	let firstUpdateStarted!: () => void;
	const firstUpdateGate = new Promise<void>((resolve) => { releaseFirstUpdate = resolve; });
	const firstUpdateRequest = new Promise<void>((resolve) => { firstUpdateStarted = resolve; });
	await concurrentFirst.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (Buffer.from(token, "base64url").toString("utf8").includes("memoryCompareSetFn")) { firstUpdateStarted(); await firstUpdateGate; }
		await route.continue();
	});
	try {
		await concurrentFirst.getByRole("button", { name: "Increment" }).click();
		await Promise.race([firstUpdateRequest, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("first update did not start")), 10000))]);
		await concurrentSecond.getByRole("button", { name: "Increment" }).click();
		await concurrentSecond.getByTestId("list").filter({ hasText: '"value":1' }).waitFor({ timeout: 10000 });
	} finally { releaseFirstUpdate(); }
	await concurrentFirst.getByTestId("list").filter({ hasText: '"value":2' }).waitFor({ timeout: 10000 });
	await concurrentSecond.getByTestId("count").filter({ hasText: "2" }).waitFor({ timeout: 10000 });
	await concurrentFirst.unrouteAll({ behavior: "wait" });
	let releaseAgentRace!: () => void;
	let agentRaceStarted!: () => void;
	const agentRaceGate = new Promise<void>((resolve) => { releaseAgentRace = resolve; });
	const agentRaceRequest = new Promise<void>((resolve) => { agentRaceStarted = resolve; });
	await concurrentFirst.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (Buffer.from(token, "base64url").toString("utf8").includes("memoryCompareSetFn")) { agentRaceStarted(); await agentRaceGate; }
		await route.continue();
	});
	try {
		await concurrentFirst.getByRole("button", { name: "Increment" }).click();
		await Promise.race([agentRaceRequest, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("agent race update did not start")), 10000))]);
		first.respond([fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "concurrent-memory", key: "count", value: 10 })), fauxAssistantMessage("ok")]);
		await first.prompt("Change the counter during a browser update");
		if (first.lastResult("artifact_memory").isError) throw new Error(first.lastResult("artifact_memory").text);
	} finally { releaseAgentRace(); }
	await concurrentFirst.getByTestId("list").filter({ hasText: '"value":11' }).waitFor({ timeout: 10000 });
	await concurrentSecond.getByTestId("count").filter({ hasText: "11" }).waitFor({ timeout: 10000 });
	await concurrentContext.close();
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "concurrent-memory", path: "concurrent-memory.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the concurrent memory counter");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "concurrent-memory", path: "concurrent-independent.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export an independent counter copy");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	const concurrentOfflineContext = await browser.newContext();
	const concurrentOfflineFirst = await concurrentOfflineContext.newPage();
	const concurrentOfflineSecond = await concurrentOfflineContext.newPage();
	const concurrentOfflineUrl = pathToFileURL(join(first.cwd, "concurrent-memory.html")).href;
	await Promise.all([concurrentOfflineFirst.goto(concurrentOfflineUrl), concurrentOfflineSecond.goto(concurrentOfflineUrl)]);
	await Promise.all([concurrentOfflineFirst.getByTestId("count").filter({ hasText: "11" }).waitFor(), concurrentOfflineSecond.getByTestId("count").filter({ hasText: "11" }).waitFor()]);
	await Promise.all([concurrentOfflineFirst.getByRole("button", { name: "Increment" }).click(), concurrentOfflineSecond.getByRole("button", { name: "Increment" }).click()]);
	await concurrentOfflineFirst.getByTestId("list").filter({ hasText: '"value":13' }).waitFor({ timeout: 10000 });
	await concurrentOfflineSecond.getByTestId("count").filter({ hasText: "13" }).waitFor({ timeout: 10000 });
	await Promise.all([concurrentOfflineFirst.getByRole("button", { name: "Set alpha" }).click(), concurrentOfflineSecond.getByRole("button", { name: "Set beta" }).click()]);
	for (const target of [concurrentOfflineFirst, concurrentOfflineSecond]) {
		await target.getByTestId("list").filter({ hasText: '"key":"alpha","value":1' }).waitFor({ timeout: 10000 });
		await target.getByTestId("list").filter({ hasText: '"key":"beta","value":2' }).waitFor({ timeout: 10000 });
	}
	const noLocksPage = await concurrentOfflineContext.newPage();
	await noLocksPage.addInitScript(() => { Object.defineProperty(navigator, "locks", { value: undefined, configurable: true }); });
	await noLocksPage.goto(concurrentOfflineUrl);
	await noLocksPage.getByTestId("count").filter({ hasText: "13" }).waitFor({ timeout: 10000 });
	await noLocksPage.getByRole("button", { name: "Increment" }).click();
	await noLocksPage.getByTestId("list").filter({ hasText: '"value":14' }).waitFor({ timeout: 10000 });
	await concurrentOfflineFirst.getByTestId("count").filter({ hasText: "14" }).waitFor({ timeout: 10000 });
	await Promise.all([noLocksPage.getByRole("button", { name: "Increment" }).click(), concurrentOfflineFirst.getByRole("button", { name: "Increment" }).click()]);
	await noLocksPage.getByTestId("list").filter({ hasText: '"value":16' }).waitFor({ timeout: 10000 });
	await concurrentOfflineFirst.getByTestId("count").filter({ hasText: "16" }).waitFor({ timeout: 10000 });
	await noLocksPage.close();
	const noCoordinationPage = await concurrentOfflineContext.newPage();
	await noCoordinationPage.addInitScript(() => {
		Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
		Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
	});
	await noCoordinationPage.goto(concurrentOfflineUrl);
	await noCoordinationPage.getByTestId("count").filter({ hasText: "16" }).waitFor({ timeout: 10000 });
	await noCoordinationPage.getByRole("button", { name: "Increment" }).click();
	await noCoordinationPage.getByTestId("error").filter({ hasText: "coordinate" }).waitFor({ timeout: 10000 });
	await noCoordinationPage.getByTestId("count").filter({ hasText: "16" }).waitFor({ timeout: 10000 });
	await noCoordinationPage.close();
	const independentOffline = await concurrentOfflineContext.newPage();
	await independentOffline.goto(pathToFileURL(join(first.cwd, "concurrent-independent.html")).href);
	await independentOffline.getByTestId("count").filter({ hasText: "11" }).waitFor({ timeout: 10000 });
	await concurrentOfflineFirst.evaluate(() => new Promise<void>((resolve, reject) => {
		const snapshot = (window as any).__PI_ARTIFACT__;
		const storage = `pi-artifact:${snapshot.artifact.id}:${snapshot.snapshotId ?? snapshot.exportedAt}`;
		const open = indexedDB.open(`pi-artifacts-memory-coordination-v2:${storage}`, 1);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const database = open.result;
			const tx = database.transaction("locks", "readwrite");
			let holding = true;
			let announced = false;
			(window as any).__releaseMemoryLock = () => { holding = false; };
			(window as any).__memoryLockFinished = new Promise<void>((done) => { tx.oncomplete = () => { database.close(); done(); }; });
			const keepAlive = () => {
				const request = tx.objectStore("locks").get("lock");
				request.onsuccess = () => {
					if (!announced) { announced = true; resolve(); }
					if (holding) keepAlive();
				};
			};
			keepAlive();
		};
	}));
	try {
		await independentOffline.getByRole("button", { name: "Increment" }).click();
		await independentOffline.getByTestId("list").filter({ hasText: '"value":12' }).waitFor({ timeout: 5000 });
		await concurrentOfflineSecond.getByRole("button", { name: "Increment" }).click();
		await concurrentOfflineSecond.getByTestId("error").filter({ hasText: "coordinate offline memory access in time" }).waitFor({ timeout: 15000 });
	} finally {
		await concurrentOfflineFirst.evaluate(() => (window as any).__releaseMemoryLock());
		await concurrentOfflineFirst.evaluate(() => (window as any).__memoryLockFinished);
	}
	await concurrentOfflineSecond.getByTestId("count").filter({ hasText: "16" }).waitFor({ timeout: 10000 });
	await concurrentOfflineSecond.getByRole("button", { name: "Increment" }).click();
	await concurrentOfflineSecond.getByTestId("list").filter({ hasText: '"value":17' }).waitFor({ timeout: 10000 });
	await independentOffline.close();
	await concurrentOfflineContext.close();
	step("concurrent functional memory updates are preserved live and offline");

	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "queued-write-error", title: "Queued write error", code: concurrentCode })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a queued write failure check");
	const queuedErrorPage = await browser.newPage();
	let compareAttempts = 0;
	await queuedErrorPage.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (Buffer.from(token, "base64url").toString("utf8").includes("memoryCompareSetFn") && ++compareAttempts === 1) {
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"first update failed"}' });
		} else await route.continue();
	});
	await queuedErrorPage.goto(openLink(first.lastResult("artifact_write").text));
	await queuedErrorPage.getByTestId("count").filter({ hasText: "0" }).waitFor({ timeout: 10000 });
	await queuedErrorPage.getByRole("button", { name: "Increment" }).evaluate((button: HTMLElement) => { button.click(); button.click(); });
	await queuedErrorPage.getByTestId("list").filter({ hasText: '"value":1' }).waitFor({ timeout: 10000 });
	await queuedErrorPage.waitForFunction(() => !!document.querySelector('[data-testid="error"]')?.textContent?.trim(), undefined, { timeout: 5000 });
	await queuedErrorPage.getByRole("button", { name: "Increment" }).click();
	await queuedErrorPage.getByTestId("list").filter({ hasText: '"value":2' }).waitFor({ timeout: 10000 });
	await queuedErrorPage.waitForFunction(() => !document.querySelector('[data-testid="error"]')?.textContent?.trim(), undefined, { timeout: 5000 });
	await queuedErrorPage.close();
	step("a failed queued update remains visible until the next user action");

	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "lost-write-response", title: "Lost write response", code: concurrentCode })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a lost write response check");
	const lostWritePage = await browser.newPage();
	let lostWriteRequests = 0;
	await lostWritePage.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (Buffer.from(token, "base64url").toString("utf8").includes("memoryCompareSetFn") && ++lostWriteRequests === 1) {
			const response = await route.fetch();
			if (!response.ok()) throw new Error("test write did not reach the server");
			await route.abort();
		} else await route.continue();
	});
	await lostWritePage.goto(openLink(first.lastResult("artifact_write").text));
	await lostWritePage.getByTestId("count").filter({ hasText: "0" }).waitFor({ timeout: 10000 });
	await lostWritePage.getByRole("button", { name: "Increment" }).click();
	await lostWritePage.getByTestId("error").filter({ hasText: "may have completed" }).waitFor({ timeout: 10000 });
	await lostWritePage.getByTestId("list").filter({ hasText: '"value":1' }).waitFor({ timeout: 10000 });
	if (lostWriteRequests !== 1) throw new Error(`write was repeated after losing its response: ${lostWriteRequests}`);
	await lostWritePage.close();
	step("lost memory write responses report an uncertain outcome without repeating");

	const longMemoryValue = `value-${"x".repeat(300)}`;
	const longTableKey = `table-${"x".repeat(300)}`;
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "memory-sync", key: "long-value", value: longMemoryValue })), fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "memory-sync", key: longTableKey, value: "stored" })), fauxAssistantMessage(fauxToolCall("artifact_link", { id: "memory-sync" })), fauxAssistantMessage("ok")]);
	await first.prompt("Open memory error check");
	const memoryErrorPage = await browser.newPage();
	let failMemoryList = true;
	let deleteRequests = 0;
	let releaseDelete!: () => void;
	let deleteStarted!: () => void;
	const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
	const deleteRequestStarted = new Promise<void>((resolve) => { deleteStarted = resolve; });
	await memoryErrorPage.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		const name = Buffer.from(token, "base64url").toString("utf8");
		if (name.includes("memoryDeleteFn")) {
			deleteRequests++;
			deleteStarted();
			await deleteGate;
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
		} else if (failMemoryList && name.includes("memoryListFn")) {
			await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
		} else await route.continue();
	});
	await memoryErrorPage.goto(openLink(first.lastResult("artifact_link").text), { waitUntil: "domcontentloaded" });
	await memoryErrorPage.getByRole("tab", { name: "Memory" }).click();
	await memoryErrorPage.getByText("Could not load memory").waitFor({ timeout: 10000 });
	if (await memoryErrorPage.getByText("Nothing stored yet.").count()) throw new Error("memory load failure was shown as empty data");
	failMemoryList = false;
	await memoryErrorPage.getByRole("button", { name: "Retry" }).click();
	await memoryErrorPage.getByRole("columnheader", { name: "Updated" }).waitFor({ timeout: 10000 });
	if (await memoryErrorPage.getByRole("columnheader", { name: "Updated" }).getAttribute("aria-sort") !== "descending") throw new Error("initial memory sort order is not announced");
	await memoryErrorPage.getByRole("button", { name: "Key", exact: true }).click();
	const keySort = await memoryErrorPage.getByRole("columnheader", { name: "Key" }).getAttribute("aria-sort");
	if (keySort !== "ascending" && keySort !== "descending") throw new Error(`memory key sort order is not announced: ${keySort}`);
	const longValue = memoryErrorPage.locator("pre").filter({ hasText: longMemoryValue });
	await longValue.waitFor({ timeout: 10000 });
	if (!(await longValue.evaluate((element) => element.scrollWidth <= element.clientWidth))) throw new Error("memory value is visually truncated");
	const longKey = memoryErrorPage.getByText(longTableKey, { exact: true });
	if (!(await longKey.evaluate((element) => element.getBoundingClientRect().width <= 240 && element.scrollWidth <= element.clientWidth))) throw new Error("long memory key expands or overflows its column");
	await memoryErrorPage.setViewportSize({ width: 320, height: 700 });
	const memoryRegion = memoryErrorPage.getByRole("region", { name: "Memory entries" });
	// Force a wide table to exercise keyboard access when content or zoom causes overflow.
	await memoryRegion.locator("table").evaluate((element) => { element.style.minWidth = "600px"; });
	const memorySize = await memoryRegion.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, left: element.scrollLeft }));
	if (memorySize.scrollWidth <= memorySize.width) throw new Error(`memory test needs horizontal overflow: ${JSON.stringify(memorySize)}`);
	await memoryRegion.focus({ timeout: 5000 });
	await memoryRegion.evaluate((element) => { element.scrollLeft = 0; });
	await memoryErrorPage.keyboard.press("ArrowRight");
	await memoryErrorPage.waitForFunction(() => (document.querySelector('[aria-label="Memory entries"]') as HTMLElement | null)?.scrollLeft! > 0, undefined, { timeout: 5000 });
	try {
		await memoryErrorPage.getByRole("button", { name: "Delete count" }).evaluate((button: HTMLElement) => { button.click(); button.click(); });
		await Promise.race([deleteRequestStarted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("delete request did not start")), 10000))]);
		const deletingButton = memoryErrorPage.getByRole("button", { name: "Deleting count" });
		await deletingButton.waitFor({ timeout: 5000 });
		if (await deletingButton.isEnabled()) throw new Error("pending deletion button is still enabled");
	} finally { releaseDelete(); }
	await memoryErrorPage.getByText("Could not delete memory").waitFor({ timeout: 10000 });
	await memoryErrorPage.waitForTimeout(300);
	if (deleteRequests !== 1) throw new Error(`duplicate memory delete requests: ${deleteRequests}`);
	if (!(await memoryErrorPage.getByRole("button", { name: "Delete count" }).count())) throw new Error("failed deletion removed the visible entry");
	if (!(await memoryErrorPage.getByRole("button", { name: "Delete count" }).isEnabled())) throw new Error("failed deletion cannot be retried");
	await memoryErrorPage.close();
	step("memory view reports load and deletion failures");
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "memory-sync", path: "memory-sync.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the memory sync demo");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "memory-sync", path: "memory-sync-other.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export a second memory sync copy");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	const snapshotPattern = /<script>window\.__PI_ARTIFACT__ = JSON\.parse\((.*?)\);<\/script>/;
	const firstHtml = readFileSync(join(first.cwd, "memory-sync.html"), "utf8");
	const secondPath = join(first.cwd, "memory-sync-other.html");
	const secondHtml = readFileSync(secondPath, "utf8");
	const firstMatch = firstHtml.match(snapshotPattern);
	const secondMatch = secondHtml.match(snapshotPattern);
	if (!firstMatch || !secondMatch) throw new Error("export snapshot script missing");
	const firstSnapshot = JSON.parse(JSON.parse(firstMatch[1]));
	const secondSnapshot = JSON.parse(JSON.parse(secondMatch[1]));
	if (!firstSnapshot.snapshotId || !secondSnapshot.snapshotId || firstSnapshot.snapshotId === secondSnapshot.snapshotId) throw new Error("exports did not get distinct identities");
	// Reproduce identical clock milliseconds while keeping the real export identities.
	secondSnapshot.exportedAt = firstSnapshot.exportedAt;
	const snapshotLiteral = JSON.stringify(JSON.stringify(secondSnapshot)).replace(/</g, "\\u003c");
	writeFileSync(secondPath, secondHtml.replace(snapshotPattern, () => `<script>window.__PI_ARTIFACT__ = JSON.parse(${snapshotLiteral});</script>`));
	const offlineContext = await browser.newContext();
	const offlineMemory = await offlineContext.newPage();
	await offlineMemory.goto(pathToFileURL(join(first.cwd, "memory-sync.html")).href);
	const offlineSecond = await offlineContext.newPage();
	await offlineSecond.goto(pathToFileURL(join(first.cwd, "memory-sync.html")).href);
	const offlineOtherExport = await offlineContext.newPage();
	await offlineOtherExport.goto(pathToFileURL(secondPath).href);
	await offlineOtherExport.getByTestId("count").filter({ hasText: "3" }).waitFor({ timeout: 10000 });
	await offlineMemory.getByRole("button", { name: "Increment" }).click();
	await offlineMemory.getByTestId("list").filter({ hasText: '"value":4' }).waitFor({ timeout: 10000 });
	await offlineSecond.getByTestId("list").filter({ hasText: '"value":4' }).waitFor({ timeout: 10000 });
	await offlineOtherExport.reload();
	await offlineOtherExport.getByTestId("count").filter({ hasText: "3" }).waitFor({ timeout: 10000 });
	await offlineOtherExport.close();
	await offlineSecond.getByRole("button", { name: "Increment" }).click();
	await offlineMemory.getByTestId("list").filter({ hasText: '"value":5' }).waitFor({ timeout: 10000 });
	await offlineMemory.reload();
	await offlineMemory.getByTestId("list").filter({ hasText: '"value":5' }).waitFor({ timeout: 10000 });
	await offlineMemory.evaluate(() => {
		const original = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key, value) {
			if ((window as any).__failMemoryWrite) throw new Error("storage full");
			return original.call(this, key, value);
		};
		(window as any).__failMemoryWrite = true;
	});
	await offlineMemory.getByRole("button", { name: "Increment" }).click();
	await offlineMemory.getByTestId("error").filter({ hasText: "Could not save" }).waitFor({ timeout: 10000 });
	await offlineMemory.getByTestId("count").filter({ hasText: "5" }).waitFor({ timeout: 10000 });
	await offlineMemory.evaluate(() => { (window as any).__failMemoryWrite = false; });
	await offlineMemory.getByRole("button", { name: "Increment" }).click();
	await offlineMemory.getByTestId("list").filter({ hasText: '"value":6' }).waitFor({ timeout: 10000 });
	await offlineSecond.getByTestId("list").filter({ hasText: '"value":6' }).waitFor({ timeout: 10000 });
	const offlineReadFailure = await offlineContext.newPage();
	await offlineReadFailure.addInitScript(() => {
		const original = Storage.prototype.getItem;
		(window as any).__failMemoryRead = true;
		Storage.prototype.getItem = function (key) {
			if ((window as any).__failMemoryRead && key.startsWith("pi-artifact:")) throw new Error("storage unavailable");
			return original.call(this, key);
		};
	});
	await offlineReadFailure.goto(pathToFileURL(join(first.cwd, "memory-sync.html")).href);
	await offlineReadFailure.getByTestId("error").filter({ hasText: "Could not read" }).waitFor({ timeout: 15000 });
	await offlineReadFailure.evaluate(() => { (window as any).__failMemoryRead = false; });
	await offlineReadFailure.getByRole("button", { name: "Increment" }).click();
	await offlineReadFailure.getByTestId("count").filter({ hasText: "7" }).waitFor({ timeout: 10000 });
	await offlineMemory.getByTestId("list").filter({ hasText: '"value":7' }).waitFor({ timeout: 10000 });
	await offlineReadFailure.close();
	await offlineSecond.close();
	await offlineMemory.close();
	await offlineContext.close();
	step("offline memory writes refresh both tabs, survive reload and recover from storage failure");

	const unicodePrefixCode = `import { useMemoryList } from "@pi/artifact"; export default function UnicodePrefix() { const q = useMemoryList({ prefix: ${JSON.stringify("\ud83d")} }); return <output>{q.isPending ? "loading" : JSON.stringify(q.data?.map((row) => row.key))}</output>; }`;
	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "unicode-prefix", key: "😀task", value: 1 })),
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "unicode-prefix", key: "�task", value: 2 })),
		fauxAssistantMessage(fauxToolCall("artifact_write", { id: "unicode-prefix", title: "Unicode prefix", code: unicodePrefixCode })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Create a Unicode prefix comparison");
	const unicodeLive = await browser.newPage();
	await unicodeLive.goto(openLink(first.lastResult("artifact_write").text));
	await unicodeLive.locator("output").filter({ hasText: '["�task"]' }).waitFor({ timeout: 10000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "unicode-prefix", path: "unicode-prefix.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the Unicode prefix comparison");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	const unicodeOffline = await browser.newPage();
	await unicodeOffline.goto(pathToFileURL(join(first.cwd, "unicode-prefix.html")).href);
	await unicodeOffline.locator("output").filter({ hasText: '["�task"]' }).waitFor({ timeout: 10000 });
	await unicodeOffline.close();
	await unicodeLive.close();
	step("Unicode prefix results match in the live and offline artifact");

	const optionalMemoryCode = 'import { useMemory, useMemoryList } from "@pi/artifact"; export default function OptionalMemory() { const [value, setValue, state] = useMemory<string | null | undefined>("optional", undefined); const list = useMemoryList(); return <><p data-testid="optional">{state.error ? "error" : state.loading ? "loading" : value === undefined ? "missing" : value === null ? "stored null" : value}</p><p data-testid="optional-list">{JSON.stringify(list.data)}</p><button onClick={() => setValue("saved")}>Save</button><button onClick={() => setValue(null)}>Save null</button><button onClick={() => setValue(undefined)}>Clear</button><button onClick={() => setValue((previous) => previous === undefined ? "updated" : `${previous}!`)}>Update</button></>; }';
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "optional-memory", title: "Optional memory", code: optionalMemoryCode })), fauxAssistantMessage("ok")]);
	await first.prompt("Create an optional memory check");
	const optionalLive = await browser.newPage();
	await optionalLive.goto(openLink(first.lastResult("artifact_write").text));
	await optionalLive.getByTestId("optional").filter({ hasText: "missing" }).waitFor({ timeout: 15000 });
	await optionalLive.getByRole("button", { name: "Save null" }).click();
	await optionalLive.getByTestId("optional-list").filter({ hasText: '"value":null' }).waitFor({ timeout: 10000 });
	await optionalLive.reload();
	await optionalLive.getByTestId("optional").filter({ hasText: "stored null" }).waitFor({ timeout: 10000 });
	await optionalLive.getByRole("button", { name: "Save", exact: true }).click();
	await optionalLive.getByTestId("optional-list").filter({ hasText: '"value":"saved"' }).waitFor({ timeout: 10000 });
	await optionalLive.getByRole("button", { name: "Clear" }).click();
	await optionalLive.getByTestId("optional-list").filter({ hasText: "[]" }).waitFor({ timeout: 10000 });
	await optionalLive.getByTestId("optional").filter({ hasText: "missing" }).waitFor({ timeout: 10000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "optional-memory", path: "optional-memory.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the optional memory check");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	const optionalOffline = await browser.newPage();
	await optionalOffline.goto(pathToFileURL(join(first.cwd, "optional-memory.html")).href);
	await optionalOffline.getByTestId("optional").filter({ hasText: "missing" }).waitFor({ timeout: 10000 });
	await optionalOffline.getByRole("button", { name: "Update" }).click();
	await optionalOffline.getByTestId("optional-list").filter({ hasText: '"value":"updated"' }).waitFor({ timeout: 10000 });
	await optionalOffline.reload();
	await optionalOffline.getByTestId("optional").filter({ hasText: "updated" }).waitFor({ timeout: 10000 });
	await optionalOffline.getByRole("button", { name: "Save null" }).click();
	await optionalOffline.getByTestId("optional-list").filter({ hasText: '"value":null' }).waitFor({ timeout: 10000 });
	await optionalOffline.reload();
	await optionalOffline.getByTestId("optional").filter({ hasText: "stored null" }).waitFor({ timeout: 10000 });
	await optionalOffline.getByRole("button", { name: "Clear" }).click();
	await optionalOffline.getByTestId("optional-list").filter({ hasText: "[]" }).waitFor({ timeout: 10000 });
	await optionalOffline.getByTestId("optional").filter({ hasText: "missing" }).waitFor({ timeout: 10000 });
	await optionalOffline.close();
	await optionalLive.close();
	step("undefined defaults and stored null remain distinct live and offline");

	const distinctDefaultsCode = 'import { useState } from "react"; import { useMemory, useMemoryList } from "@pi/artifact"; export default function DistinctDefaults() { const [defaultB, setDefaultB] = useState("second"); const [a, setA, first] = useMemory<string>("choice", "first"); const [b, setB, second] = useMemory<string>("choice", defaultB); const list = useMemoryList(); return <><p data-testid="first">{first.loading ? "loading" : a}</p><p data-testid="second">{second.loading ? "loading" : b}</p><p data-testid="defaults-list">{JSON.stringify(list.data)}</p><button onClick={() => setA("saved")}>Save choice</button><button onClick={() => setA(undefined)}>Clear choice</button><button onClick={() => setA(() => undefined)}>Clear via update</button><button onClick={() => setDefaultB("changed")}>Change default</button><button onClick={() => setDefaultB("second")}>Reset default</button><button onClick={() => setB((previous) => `${previous}!`)}>Update second</button></>; }';
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "distinct-defaults", title: "Distinct defaults", code: distinctDefaultsCode })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a shared memory defaults check");
	const defaultsLive = await browser.newPage();
	await defaultsLive.goto(openLink(first.lastResult("artifact_write").text));
	await defaultsLive.getByTestId("first").filter({ hasText: "first" }).waitFor({ timeout: 10000 });
	await defaultsLive.getByTestId("second").filter({ hasText: "second" }).waitFor({ timeout: 10000 });
	const checkChangedDefault = async (target: typeof defaultsLive) => {
		await target.getByRole("button", { name: "Change default" }).click();
		await target.getByTestId("second").filter({ hasText: "changed" }).waitFor({ timeout: 10000 });
		await target.getByRole("button", { name: "Update second" }).click();
		await target.getByTestId("defaults-list").filter({ hasText: '"value":"changed!"' }).waitFor({ timeout: 10000 });
		await target.getByTestId("first").filter({ hasText: "changed!" }).waitFor({ timeout: 10000 });
		await target.getByRole("button", { name: "Clear choice" }).click();
		await target.getByTestId("defaults-list").filter({ hasText: "[]" }).waitFor({ timeout: 10000 });
		await target.getByRole("button", { name: "Reset default" }).click();
		await target.getByTestId("second").filter({ hasText: "second" }).waitFor({ timeout: 10000 });
	};
	await checkChangedDefault(defaultsLive);
	await defaultsLive.getByRole("button", { name: "Save choice" }).click();
	await defaultsLive.getByTestId("defaults-list").filter({ hasText: '"value":"saved"' }).waitFor({ timeout: 10000 });
	await defaultsLive.getByTestId("second").filter({ hasText: "saved" }).waitFor({ timeout: 10000 });
	await defaultsLive.getByRole("button", { name: "Clear via update" }).click();
	await defaultsLive.getByTestId("defaults-list").filter({ hasText: "[]" }).waitFor({ timeout: 10000 });
	await defaultsLive.getByTestId("first").filter({ hasText: "first" }).waitFor({ timeout: 10000 });
	await defaultsLive.getByTestId("second").filter({ hasText: "second" }).waitFor({ timeout: 10000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "distinct-defaults", path: "distinct-defaults.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the shared memory defaults check");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	const defaultsOffline = await browser.newPage();
	await defaultsOffline.goto(pathToFileURL(join(first.cwd, "distinct-defaults.html")).href);
	await defaultsOffline.getByTestId("first").filter({ hasText: "first" }).waitFor({ timeout: 10000 });
	await defaultsOffline.getByTestId("second").filter({ hasText: "second" }).waitFor({ timeout: 10000 });
	await checkChangedDefault(defaultsOffline);
	await defaultsOffline.getByRole("button", { name: "Save choice" }).click();
	await defaultsOffline.getByTestId("defaults-list").filter({ hasText: '"value":"saved"' }).waitFor({ timeout: 10000 });
	await defaultsOffline.getByRole("button", { name: "Clear via update" }).click();
	await defaultsOffline.getByTestId("defaults-list").filter({ hasText: "[]" }).waitFor({ timeout: 10000 });
	await defaultsOffline.getByTestId("first").filter({ hasText: "first" }).waitFor({ timeout: 10000 });
	await defaultsOffline.getByTestId("second").filter({ hasText: "second" }).waitFor({ timeout: 10000 });
	await defaultsOffline.close();
	await defaultsLive.close();
	step("memory hooks retain their own defaults for missing keys");

	const invalidMemoryCode = 'import { useMemory, useMemoryList } from "@pi/artifact"; export default function InvalidMemory() { const [value, setValue, state] = useMemory<any>("item", "initial"); const list = useMemoryList(); const [object, setObject, objectState] = useMemory<any>("object", { count: 0 }); return <><p data-testid="object">{JSON.stringify(object)}</p><p data-testid="object-error">{objectState.error ? String(objectState.error) : ""}</p><button onClick={() => setObject((v: any) => { v.count = 999; throw new Error("object updater failed"); })}>Mutate and throw</button><p data-testid="value">{state.loading ? "loading" : String(value)}</p><p data-testid="error">{state.error ? String(state.error) : ""}</p><p data-testid="list">{JSON.stringify(list.data)}</p><button onClick={() => setValue(1n)}>Invalid value</button><button onClick={() => setValue(() => { throw new Error("updater failed"); })}>Throwing updater</button><button onClick={() => setValue("new")}>Valid value</button><button onClick={() => { let calls = 0; setValue({ toJSON: () => ++calls === 1 ? "once" : "again" }); }}>Stateful value</button></>; }';
	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "invalid-memory", key: "item", value: "kept" })),
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "invalid-memory", key: "object", value: { count: 1 } })),
		fauxAssistantMessage(fauxToolCall("artifact_write", { id: "invalid-memory", title: "Invalid memory", code: invalidMemoryCode })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Create a memory serialization check");
	const invalidLive = await browser.newPage();
	let invalidRequests = 0;
	await invalidLive.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		const name = Buffer.from(token, "base64url").toString("utf8");
		if (name.includes("memorySetFn") || name.includes("memoryCompareSetFn")) invalidRequests++;
		await route.continue();
	});
	await invalidLive.goto(openLink(first.lastResult("artifact_write").text));
	await invalidLive.getByTestId("value").filter({ hasText: "kept" }).waitFor({ timeout: 10000 });
	await invalidLive.getByRole("button", { name: "Invalid value" }).click();
	await invalidLive.getByTestId("error").filter({ hasText: "JSON serializable" }).waitFor({ timeout: 10000 });
	await invalidLive.getByTestId("value").filter({ hasText: "kept" }).waitFor({ timeout: 10000 });
	if (invalidRequests !== 0) throw new Error("invalid memory value was sent to the server");
	await invalidLive.getByRole("button", { name: "Throwing updater" }).click();
	await invalidLive.getByTestId("error").filter({ hasText: "updater failed" }).waitFor({ timeout: 10000 });
	await invalidLive.getByTestId("value").filter({ hasText: "kept" }).waitFor({ timeout: 10000 });
	if (invalidRequests !== 0) throw new Error("throwing updater sent a memory write to the server");
	await invalidLive.getByTestId("object").filter({ hasText: '{"count":1}' }).waitFor({ timeout: 10000 });
	await invalidLive.getByRole("button", { name: "Mutate and throw" }).click();
	await invalidLive.getByTestId("object-error").filter({ hasText: "object updater failed" }).waitFor({ timeout: 10000 });
	await invalidLive.getByTestId("object").filter({ hasText: '{"count":1}' }).waitFor({ timeout: 10000 });
	if (invalidRequests !== 0) throw new Error("throwing object updater sent a memory write to the server");
	const validMemoryWrite = invalidLive.waitForResponse((response) => response.ok() && Buffer.from(new URL(response.url()).pathname.split("/").at(-1) ?? "", "base64url").toString("utf8").includes("memorySetFn"), { timeout: 10000 });
	await invalidLive.getByRole("button", { name: "Valid value", exact: true }).click();
	await invalidLive.getByTestId("value").filter({ hasText: "new" }).waitFor({ timeout: 10000 });
	await validMemoryWrite;
	await invalidLive.getByRole("button", { name: "Stateful value" }).click();
	await invalidLive.getByTestId("list").filter({ hasText: '"value":"once"' }).waitFor({ timeout: 10000 });
	await invalidLive.getByTestId("value").filter({ hasText: "once" }).waitFor({ timeout: 10000 });
	await invalidLive.reload();
	await invalidLive.getByTestId("value").filter({ hasText: "once" }).waitFor({ timeout: 10000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "invalid-memory", path: "invalid-memory.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the memory serialization check");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	const invalidOffline = await browser.newPage();
	await invalidOffline.goto(pathToFileURL(join(first.cwd, "invalid-memory.html")).href);
	await invalidOffline.getByTestId("value").filter({ hasText: "once" }).waitFor({ timeout: 10000 });
	await invalidOffline.getByRole("button", { name: "Invalid value" }).click();
	await invalidOffline.getByTestId("error").filter({ hasText: "JSON serializable" }).waitFor({ timeout: 10000 });
	await invalidOffline.getByTestId("value").filter({ hasText: "once" }).waitFor({ timeout: 10000 });
	await invalidOffline.getByTestId("object").filter({ hasText: '{"count":1}' }).waitFor({ timeout: 10000 });
	await invalidOffline.getByRole("button", { name: "Mutate and throw" }).click();
	await invalidOffline.getByTestId("object-error").filter({ hasText: "object updater failed" }).waitFor({ timeout: 10000 });
	await invalidOffline.getByTestId("object").filter({ hasText: '{"count":1}' }).waitFor({ timeout: 10000 });
	await invalidOffline.getByRole("button", { name: "Throwing updater" }).click();
	await invalidOffline.getByTestId("error").filter({ hasText: "updater failed" }).waitFor({ timeout: 10000 });
	await invalidOffline.getByTestId("value").filter({ hasText: "once" }).waitFor({ timeout: 10000 });
	await invalidOffline.getByRole("button", { name: "Valid value", exact: true }).click();
	await invalidOffline.getByTestId("list").filter({ hasText: '"value":"new"' }).waitFor({ timeout: 10000 });
	await invalidOffline.getByRole("button", { name: "Stateful value" }).click();
	await invalidOffline.getByTestId("list").filter({ hasText: '"value":"once"' }).waitFor({ timeout: 10000 });
	await invalidOffline.reload();
	await invalidOffline.getByTestId("value").filter({ hasText: "once" }).waitFor({ timeout: 10000 });
	await invalidOffline.close();
	await invalidLive.close();
	step("invalid memory values are rejected without changing saved data");

	const inputSnapshotCode = 'import { useState } from "react"; import { memory, useArtifact } from "@pi/artifact"; export default function InputSnapshot() { const { id } = useArtifact(); const [result, setResult] = useState("waiting"); return <><p data-testid="snapshot">{result}</p><button onClick={async () => { const value = { items: ["before"] }; const pending = memory.set(id, "snapshot", value); value.items.push("after"); await pending; setResult(JSON.stringify(await memory.get(id, "snapshot"))); }}>Check snapshot</button></>; }';
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "input-snapshot", title: "Memory input snapshot", code: inputSnapshotCode })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a memory input snapshot check");
	const snapshotLive = await browser.newPage();
	await snapshotLive.goto(openLink(first.lastResult("artifact_write").text));
	await snapshotLive.getByRole("button", { name: "Check snapshot" }).click();
	await snapshotLive.getByTestId("snapshot").filter({ hasText: '{"items":["before"]}' }).waitFor({ timeout: 10000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "input-snapshot", path: "input-snapshot.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the memory input snapshot check");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	const snapshotOffline = await browser.newPage();
	await snapshotOffline.goto(pathToFileURL(join(first.cwd, "input-snapshot.html")).href);
	await snapshotOffline.getByRole("button", { name: "Check snapshot" }).click();
	await snapshotOffline.getByTestId("snapshot").filter({ hasText: '{"items":["before"]}' }).waitFor({ timeout: 10000 });
	await snapshotOffline.close();
	await snapshotLive.close();
	step("memory.set snapshots its input live and offline");

	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "loading-memory", key: "count", value: 10 })),
		fauxAssistantMessage(fauxToolCall("artifact_write", { id: "loading-memory", title: "Loading memory", code: 'import { useMemory } from "@pi/artifact"; export default function LoadingMemory() { const [value, setValue] = useMemory("count", 0); return <><p data-testid="count">{value}</p><button onClick={() => setValue(v => v + 1)}>Add</button></>; }' })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Create a reader with a saved count");
	const loadingPage = await browser.newPage();
	let releaseRead!: () => void;
	let readStarted!: () => void;
	let writesFinished!: () => void;
	let completedWrites = 0;
	const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
	const readRequest = new Promise<void>((resolve) => { readStarted = resolve; });
	const savedWrites = new Promise<void>((resolve) => { writesFinished = resolve; });
	loadingPage.on("response", (response) => {
		const token = new URL(response.url()).pathname.split("/").at(-1) ?? "";
		if (response.ok() && Buffer.from(token, "base64url").toString("utf8").includes("memoryCompareSetFn") && ++completedWrites === 2) writesFinished();
	});
	await loadingPage.route("**/_serverFn/**", async (route) => {
		const token = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
		if (Buffer.from(token, "base64url").toString("utf8").includes("memoryGetFn")) { readStarted(); await readGate; }
		await route.continue();
	});
	try {
		await loadingPage.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "domcontentloaded" });
		await Promise.race([readRequest, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("memory read did not start")), 10000))]);
		await loadingPage.getByRole("button", { name: "Add" }).evaluate((button: HTMLElement) => { button.click(); button.click(); });
		await loadingPage.waitForTimeout(500);
		first.respond([fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "get", scope: "loading-memory", key: "count" })), fauxAssistantMessage("ok")]);
		await first.prompt("Read the saved count while loading");
		if (first.lastResult("artifact_memory").text.trim() !== "10") throw new Error("a functional update overwrote memory before the initial read finished");
	} finally {
		releaseRead();
		await loadingPage.unrouteAll({ behavior: "wait" });
	}
	await loadingPage.getByTestId("count").filter({ hasText: "12" }).waitFor({ timeout: 10000 });
	await Promise.race([savedWrites, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("queued memory writes did not finish")), 10000))]);
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "get", scope: "loading-memory", key: "count" })), fauxAssistantMessage("ok")]);
	await first.prompt("Check the saved count");
	if (first.lastResult("artifact_memory").text.trim() !== "12") throw new Error("queued functional updates were not saved in order");
	await loadingPage.close();
	step("functional memory updates wait for the initial saved value");

	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "shared", key: "e2e-theme", value: "indigo" })),
		fauxAssistantMessage(fauxToolCall("artifact_write", { id: "shared-reader", title: "Shared reader", code: 'import { useMemory } from "@pi/artifact"; export default function SharedReader() { const [value] = useMemory("e2e-theme", "loading", { scope: "shared" }); return <p>{value}</p>; }' })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Create a shared memory reader");
	const sharedPage = await browser.newPage();
	await sharedPage.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "networkidle" });
	await sharedPage.getByText("indigo", { exact: true }).waitFor({ timeout: 10000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "shared-reader", path: "shared-reader.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the shared memory reader");
	const sharedExport = first.lastResult("artifact_export");
	if (sharedExport.isError || !/1 shared key\(s\) \(e2e-theme\)/.test(sharedExport.text)) throw new Error(`shared read missing from export: ${sharedExport.text}`);
	await sharedPage.close();
	step("shared memory read on first render is included in the export");

	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "shared", key: "e2e-public:one", value: "visible" })),
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "shared", key: "e2e-private", value: "not-read" })),
		fauxAssistantMessage(fauxToolCall("artifact_write", { id: "shared-list", title: "Shared list", code: 'import { useMemoryList } from "@pi/artifact"; export default function SharedList() { const q = useMemoryList({ scope: "shared", prefix: "e2e-public:" }); return <p>{JSON.stringify(q.data)}</p>; }' })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Create a filtered shared memory reader");
	const sharedList = await browser.newPage();
	await sharedList.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "networkidle" });
	await sharedList.getByText(/e2e-public:one/).waitFor({ timeout: 10000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "shared-list", path: "shared-list.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the filtered reader");
	const filteredExport = first.lastResult("artifact_export");
	if (filteredExport.isError || !/1 shared key\(s\) \(e2e-public:one\)/.test(filteredExport.text)) throw new Error(`filtered shared read exported unrelated keys: ${filteredExport.text}`);
	await sharedList.close();
	step("filtered shared memory export excludes unrelated keys");

	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "shared-all", title: "Shared all", code: 'import { useMemoryList } from "@pi/artifact"; export default function SharedAll() { const q = useMemoryList({ scope: "shared" }); return <p>{JSON.stringify(q.data)}</p>; }' })), fauxAssistantMessage("ok")]);
	await first.prompt("Create an all-shared reader");
	const allShared = await browser.newPage();
	await allShared.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "networkidle" });
	await allShared.getByText(/e2e-private/).waitFor({ timeout: 10000 });
	await allShared.close();
	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "shared", key: "e2e-added-later", value: "not-observed" })),
		fauxAssistantMessage(fauxToolCall("artifact_export", { id: "shared-all", path: "shared-all.html" })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Add a new shared key and export the closed reader");
	const allExport = first.lastResult("artifact_export");
	if (allExport.isError || !/3 shared key\(s\)/.test(allExport.text) || allExport.text.includes("e2e-added-later")) throw new Error(`export included an unobserved shared key: ${allExport.text}`);
	step("shared keys created after the last read are not exported");

	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "missing-shared", title: "Missing shared", code: 'import { useMemory } from "@pi/artifact"; export default function MissingShared() { const [value,, state] = useMemory("e2e-missing", "absent", { scope: "shared" }); return <p>{state.loading ? "loading" : value}</p>; }' })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a reader for a missing shared key");
	const missingPage = await browser.newPage();
	await missingPage.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "networkidle" });
	await missingPage.getByText("absent", { exact: true }).waitFor({ timeout: 10000 });
	await missingPage.close();
	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "shared", key: "e2e-missing", value: "not-observed" })),
		fauxAssistantMessage(fauxToolCall("artifact_export", { id: "missing-shared", path: "missing-shared.html" })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Set the missing key and export the closed reader");
	const missingExport = first.lastResult("artifact_export");
	if (missingExport.isError || !/0 shared key\(s\)/.test(missingExport.text)) throw new Error(`unobserved shared value was exported: ${missingExport.text}`);
	step("a previously missing shared key is not exported until its value is read");

	// 2. Runtime errors in an open tab come back to the agent.
	first.respond([
		fauxAssistantMessage(
			fauxToolCall("artifact_write", { id, title: "MCP demo", code: 'export default function Broken() { throw new Error("boom from render"); }', mcp: ["echo.*"] }),
		),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Break it");
	const broken = first.lastResult("artifact_write");


	if (!broken.isError || !broken.text.includes("boom from render")) {
		const state = await page.evaluate(() => ({ visibility: document.visibilityState, url: location.href, text: document.body.innerText.slice(0, 200) }));
		throw new Error(`runtime error not reported (last ping: ${lastPing}, page: ${JSON.stringify(state)}):\n${broken.text}`);
	}
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
	// Navigate within the same viewer: its QueryClient survives the route change.
	const mcpDiagnostics: string[] = [];
	const mcpName = (url: string) => {
		const token = new URL(url).pathname.split("/").at(-1) ?? "";
		return Buffer.from(token, "base64url").toString("utf8").includes("mcpCallFn");
	};
	const onMcpRequest = (request: { url(): string }) => { if (mcpName(request.url())) mcpDiagnostics.push("request"); };
	const onMcpResponse = (response: { url(): string; status(): number }) => { if (mcpName(response.url())) mcpDiagnostics.push(`response ${response.status()}`); };
	const onMcpFailure = (request: { url(): string; failure(): { errorText: string } | null }) => { if (mcpName(request.url())) mcpDiagnostics.push(`failure ${request.failure()?.errorText ?? "unknown"}`); };
	page.on("request", onMcpRequest);
	page.on("response", onMcpResponse);
	page.on("requestfailed", onMcpFailure);
	await page.getByRole("link", { name: "All artifacts" }).click();
	await page.getByRole("link", { name: /No MCP/ }).click();
	await page.getByText(/not in this artifact's MCP allowlist/).waitFor({ timeout: 10000 }).catch(async (error) => {
		throw new Error(`MCP result after navigation: ${(await page.innerText("body")).slice(0, 500)}; MCP traffic: ${mcpDiagnostics.join(", ") || "none"}`, { cause: error });
	});
	page.off("request", onMcpRequest);
	page.off("response", onMcpResponse);
	page.off("requestfailed", onMcpFailure);
	await page.getByRole("link", { name: "All artifacts" }).click();
	await page.getByRole("link", { name: /MCP demo/ }).click();
	await page.getByText("★ 1234").waitFor({ timeout: 30000 });
	const noMcp = await browser.newPage();
	await noMcp.goto(openLink(first.lastResult("artifact_write").text));
	await noMcp.getByText(/not in this artifact's MCP allowlist/).waitFor({ timeout: 20000 });
	await noMcp.close();
	step("MCP calls outside the artifact's allowlist are refused");

	const permissionCode = 'import { useMcp } from "@pi/artifact";\nexport default function Permission() { const q = useMcp("echo.stats", {}, { retry: false }); return <p>{q.error ? String(q.error.message) : q.isPending ? "…" : "allowed"}</p>; }';
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "permission-test", title: "Permission test", code: permissionCode, mcp: ["echo.stats"] })), fauxAssistantMessage("ok")]);
	await first.prompt("Create a permission test");
	const permissionPage = await browser.newPage();
	await permissionPage.goto(openLink(first.lastResult("artifact_write").text), { waitUntil: "networkidle" });
	await permissionPage.getByText("allowed", { exact: true }).waitFor({ timeout: 20000 });
	await permissionPage.getByRole("link", { name: "All artifacts" }).click();
	const state = JSON.parse(readFileSync(join(dir, ".state", "viewer.json"), "utf8"));
	const deleted = await fetch(`${state.url}/__pi/api/artifacts/delete`, { method: "POST", headers: { "x-pi-artifacts-secret": state.secret, "content-type": "application/json" }, body: JSON.stringify({ id: "permission-test" }) });
	if (!deleted.ok) throw new Error("Could not delete the permission test artifact");
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "permission-test", title: "Permission test", code: permissionCode, mcp: ["echo.stats"] })), fauxAssistantMessage("ok")]);
	await first.prompt("Recreate the permission test");
	const newMcpCall = permissionPage.waitForRequest((request) => {
		const token = new URL(request.url()).pathname.split("/").at(-1) ?? "";
		return Buffer.from(token, "base64url").toString("utf8").includes("mcpCallFn");
	}, { timeout: 10000 });
	await permissionPage.getByRole("link", { name: /Permission test/ }).click();
	await newMcpCall;
	await permissionPage.getByText("allowed", { exact: true }).waitFor({ timeout: 20000 });
	step("recreated artifact makes its own MCP request");
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "permission-test", title: "Permission test", code: permissionCode, mcp: [] })), fauxAssistantMessage("ok")]);
	await first.prompt("Revoke the permission");
	await permissionPage.getByText(/not in this artifact's MCP allowlist/).waitFor({ timeout: 20000 });
	await permissionPage.close();
	step("changing an artifact's allowlist invalidates its MCP result");
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "permission-test", path: "permission-test.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export after revoking access");
	const permissionExport = first.lastResult("artifact_export");
	if (permissionExport.isError || !/0 MCP result/.test(permissionExport.text)) throw new Error(`revoked MCP result was exported: ${permissionExport.text}`);
	step("export excludes MCP results for revoked tools");

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
	const previousMemoryResults = first.results("artifact_memory").length;
	first.respond([
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "memory-sync", key: "null-check", value: null })),
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: "memory-sync", key: "null-check" })),
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "get", scope: "memory-sync", key: "null-check" })),
		fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "get", scope: "memory-sync", key: "never-set" })),
		fauxAssistantMessage("ok"),
	]);
	await first.prompt("Check null and missing memory values");
	const memoryResults = first.results("artifact_memory").slice(previousMemoryResults);
	if (memoryResults.length !== 4 || memoryResults[0].isError || !memoryResults[1].isError || !memoryResults[1].text.includes("value is required") || memoryResults[2].isError || memoryResults[2].text !== "null" || memoryResults[3].isError || !memoryResults[3].text.includes("No value found")) throw new Error(`memory presence results: ${JSON.stringify(memoryResults)}`);
	step("artifact_memory distinguishes stored null and missing keys");

	// 5. Export: one file, embeds own memory and cached MCP results, reports what it embeds.
	const priorHistory = await page.getByTestId("history").locator("li").count();
	await page.getByRole("button", { name: "Reverse" }).click();
	await page.waitForFunction((count) => document.querySelectorAll('[data-testid="history"] li').length > count, priorHistory, { timeout: 10000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id, path: "demo.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export it");
	const exported = first.lastResult("artifact_export").text;
	const html = readFileSync(join(first.cwd, "demo.html"), "utf8");
	if (!html.includes("ip olleh") || !html.includes('\\"stars\\":1234') || !/1 memory key/.test(exported) || !exported.includes('mcp__echo__reverse {"text":"hello pi"}')) throw new Error(`export:\n${exported}`);
	const offline = await browser.newPage();
	const requests: string[] = [];
	offline.on("request", (r: { url(): string }) => !/^(file|data|blob):/.test(r.url()) && requests.push(r.url()));
	offline.on("console", (m: any) => process.env.E2E_DEBUG && console.log("[offline]", m.text().slice(0, 300)));
	offline.on("pageerror", (e: Error) => process.env.E2E_DEBUG && console.log("[offline error]", e.message));
	await offline.goto(pathToFileURL(join(first.cwd, "demo.html")).href);
	if (process.env.E2E_DEBUG) {
		await offline.waitForTimeout(2000);
		console.log("OFFLINE:", (await offline.innerText("body")).slice(0, 500));
	}
	await offline.getByText("★ 1234").waitFor({ timeout: 10000 });
	const offlineHistory = await offline.getByTestId("history").locator("li").count();
	await offline.getByRole("button", { name: "Reverse" }).click();
	await offline.waitForFunction((count) => document.querySelectorAll('[data-testid="history"] li').length > count, offlineHistory, { timeout: 10000 });
	if (requests.length) throw new Error(`export made network requests: ${requests}`);
	await offline.close();
	step(`artifact_export: ${(html.length / 1024).toFixed(0)} KB, works offline from file://`);

	const replayDemo = `import { callMcp, useMcp } from "@pi/artifact";
import { useState } from "react";
export default function ReplayDemo() {
  const query = useMcp("echo.stats");
  const [result, setResult] = useState("");
  return <><p>{query.data ? "ready" : "loading"}</p><button onClick={async () => {
    const first = await callMcp("echo.stats");
    first.data.stars = -1;
    const second = await callMcp("echo.stats");
    setResult(String(second.data.stars));
  }}>Check replay</button><output>{result}</output></>;
}`;
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "replay-isolation", title: "Replay isolation", code: replayDemo, mcp: ["echo.stats"] })), fauxAssistantMessage("ok")]);
	await first.prompt("Create an MCP replay isolation check");
	const replayLive = await browser.newPage();
	await replayLive.goto(openLink(first.lastResult("artifact_write").text));
	await replayLive.getByText("ready", { exact: true }).waitFor({ timeout: 10000 });
	await replayLive.close();
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_export", { id: "replay-isolation", path: "replay-isolation.html" })), fauxAssistantMessage("ok")]);
	await first.prompt("Export the replay isolation check");
	if (first.lastResult("artifact_export").isError) throw new Error(first.lastResult("artifact_export").text);
	const replayOffline = await browser.newPage();
	await replayOffline.goto(pathToFileURL(join(first.cwd, "replay-isolation.html")).href);
	await replayOffline.getByText("ready", { exact: true }).waitFor({ timeout: 10000 });
	await replayOffline.getByRole("button", { name: "Check replay" }).click();
	await replayOffline.locator("output").getByText("1234", { exact: true }).waitFor({ timeout: 10000 });
	await replayOffline.close();
	step("offline MCP replay is isolated from caller mutations");

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
	await offlineDiagram.goto(pathToFileURL(join(first.cwd, "diagram.html")).href);
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
	for (const n of ["dashboard", "data-table", "diagram", "form-tool", "mcp-explorer", "project-plan", "style-guide"]) if (!names.includes(n)) throw new Error(`template ${n} missing: ${names}`);
	const preview = await browser.newPage();
	await preview.goto(openLink(saved.text, "Preview"));
	await preview.getByText("hello template").waitFor({ timeout: 20000 });
	await preview.waitForFunction(() => {
		const el = [...document.querySelectorAll("p")].find((node) => node.textContent === "hello template");
		return el && getComputedStyle(el).fontSize === "31px";
	}, undefined, { timeout: 10000 }).catch(() => {});
	const templateFontSize = await preview.getByText("hello template").evaluate((el) => getComputedStyle(el).fontSize);
	if (templateFontSize !== "31px") throw new Error(`template styles were not generated: ${templateFontSize}`);
	await preview.close();
	step(`artifact_template: ${names.length} templates; saved one renders at /t/e2e-hello`);
	const longTemplateName = `long-${"a".repeat(59)}`;
	const longTemplateCode = 'import { useMcp, useMemory } from "@pi/artifact"; export default function LongTemplate() { const [count, setCount] = useMemory("count", 0); const q = useMcp("echo.stats"); return <><button onClick={() => setCount(v => v + 1)}>Count {count}</button><p>Stars {q.data?.data?.stars ?? "loading"}</p></>; }';
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_template", {
		action: "save", name: longTemplateName, title: "Long name", description: "Boundary test", useCases: ["test"], mcp: ["echo.stats"],
		code: longTemplateCode,
	})), fauxAssistantMessage("ok")]);
	await first.prompt("Make a maximum-length template");
	const longTemplate = first.lastResult("artifact_template");
	if (longTemplate.isError) throw new Error(longTemplate.text);
	const longPreview = await browser.newPage();
	await longPreview.goto(openLink(longTemplate.text, "Preview"), { waitUntil: "networkidle" });
	await longPreview.getByText("Stars 1234").waitFor({ timeout: 30000 });
	await longPreview.getByRole("button", { name: "Count 0" }).click();
	await longPreview.getByRole("button", { name: "Count 1" }).waitFor({ timeout: 10000 });
	await longPreview.reload({ waitUntil: "networkidle" });
	await longPreview.getByRole("button", { name: "Count 1" }).waitFor({ timeout: 10000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "get", scope: `template-${longTemplateName}`, key: "count" })), fauxAssistantMessage("ok")]);
	await first.prompt("Read the template preview count");
	if (first.lastResult("artifact_memory").text.trim() !== "1") throw new Error("template preview memory was not readable from Pi");
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_memory", { action: "set", scope: `template-${longTemplateName}`, key: "count", value: 2 })), fauxAssistantMessage("ok")]);
	await first.prompt("Update the template preview count");
	if (first.lastResult("artifact_memory").isError) throw new Error(first.lastResult("artifact_memory").text);
	await longPreview.getByRole("button", { name: "Count 2" }).waitFor({ timeout: 10000 });
	const refreshedMcp = longPreview.waitForResponse((response) => {
		const token = new URL(response.url()).pathname.split("/").at(-1) ?? "";
		return response.ok() && Buffer.from(token, "base64url").toString("utf8").includes("mcpCallFn");
	}, { timeout: 20000 });
	first.respond([fauxAssistantMessage(fauxToolCall("artifact_template", {
		action: "save", name: longTemplateName, title: "Long name revised", description: "Boundary test", useCases: ["test"], mcp: ["echo.stats"], code: longTemplateCode,
	})), fauxAssistantMessage("ok")]);
	await first.prompt("Revise the template while its preview is open");
	if (first.lastResult("artifact_template").isError) throw new Error(first.lastResult("artifact_template").text);
	await refreshedMcp;
	await longPreview.getByText("Template: Long name revised").waitFor({ timeout: 10000 });
	await longPreview.getByRole("button", { name: "Count 2" }).waitFor({ timeout: 10000 });
	await longPreview.close();
	step("maximum-length template previews share memory with Pi and refresh MCP on save");
	if (!customTemplates) {
		first.respond([fauxAssistantMessage(fauxToolCall("artifact_template", {
			action: "save", name: "cross-root", title: "Cross root", description: "Reads a sibling artifact module", useCases: ["test"],
			code: 'import { label } from "../../relative-demo/helper"; export default function CrossRoot() { return <p>Cross {label}</p>; }',
		})), fauxAssistantMessage("ok")]);
		await first.prompt("Create a template using a sibling module");
		const cross = first.lastResult("artifact_template");
		if (cross.isError) throw new Error(cross.text);
		const crossPage = await browser.newPage();
		await crossPage.goto(openLink(cross.text, "Preview"), { waitUntil: "networkidle" });
		await crossPage.getByText("Cross second", { exact: true }).waitFor({ timeout: 10000 });
		await crossPage.close();
		step("nested template imports retain their relative paths");
	}

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

	// Valid local CSS imports must keep working while blocked imports stay private.
	{
		const safeDir = join(dir, "css-safe");
		mkdirSync(safeDir, { recursive: true });
		writeFileSync(join(safeDir, "safe.css"), ":root { --pi-safe-css: SAFE_MARKER; }");
		writeFileSync(join(safeDir, "style.css"), '@import "./safe.css";');
		second.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "css-safe", title: "Safe CSS", code: 'import "./style.css"; export default function SafeCss() { return <p>Safe CSS</p>; }' })), fauxAssistantMessage("ok")]);
		await second.prompt("Create a safe CSS artifact");
		const safeResult = second.lastResult("artifact_write");
		if (safeResult.isError) throw new Error(safeResult.text);
		const safePage = await browser.newPage();
		await safePage.goto(openLink(safeResult.text), { waitUntil: "networkidle" });
		await safePage.getByRole("tabpanel", { name: "Preview" }).getByText("Safe CSS", { exact: true }).waitFor({ timeout: 10000 });
		const value = await safePage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--pi-safe-css").trim());
		await safePage.close();
		if (value !== "SAFE_MARKER") throw new Error(`valid local CSS was not applied: ${value}`);
	}

	// CSS @import must not bypass Vite's filesystem restrictions through a symlink.
	const cssSecretDir = temporaryDir("pi-css-secret-");
	const cssArtifactDir = join(dir, "css-escape");
	mkdirSync(cssArtifactDir, { recursive: true });
	writeFileSync(join(cssSecretDir, "secret.css"), ":root { --pi-private-css: EXPOSED_MARKER; }");
	symlinkSync(join(cssSecretDir, "secret.css"), join(cssArtifactDir, "leak.css"), "file");
	writeFileSync(join(cssArtifactDir, "style.css"), '@import "./leak.css";');
	try {
		second.respond([fauxAssistantMessage(fauxToolCall("artifact_write", { id: "css-escape", title: "CSS test", code: 'import "./style.css"; export default function CssTest() { return <p>CSS test</p>; }' })), fauxAssistantMessage("ok")]);
		await second.prompt("Create a CSS test artifact");
		const result = second.lastResult("artifact_write");
		if (result.isError) throw new Error(`unexpected error before CSS load: ${result.text}`);
		const cssPage = await browser.newPage();
		await cssPage.goto(openLink(result.text), { waitUntil: "networkidle" });
		await cssPage.getByText("CSS test", { exact: true }).waitFor({ timeout: 10000 }).catch(() => {});
		const leaked = await cssPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--pi-private-css").trim());
		await cssPage.close();
		if (leaked === "EXPOSED_MARKER") throw new Error("CSS @import exposed a file outside the allowed roots");
	} finally {
		removeTemporaryDir(cssSecretDir);
	}
	step("CSS imports do not expose files outside allowed roots");

	console.log("\nE2E OK");
} catch (error) {
	failed = true;
	console.error("E2E FAILED:", error);
	if (navigationEvents.length) console.error("Recent navigation events:\n" + navigationEvents.join("\n"));
} finally {
	await browser?.close().catch(() => {});
	// Stop the daemon so the test leaves nothing running.
	try {
		const state = JSON.parse(readFileSync(join(dir, ".state", "viewer.json"), "utf8"));
		await fetch(`${state.url}/__pi/api/shutdown`, { method: "POST", headers: { "x-pi-artifacts-secret": state.secret } });
	} catch {}
	await second?.close().catch(() => {});
	await first?.close().catch(() => {});
	await new Promise((r) => setTimeout(r, 500));
	for (const path of temporaryDirs) removeTemporaryDir(path);
	if (failed) console.error(`Test data retained at ${dir}`);
	else testEnvironment.cleanup();
	process.exit(failed ? 1 : 0);
}
