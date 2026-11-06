/**
 * Render every bundled template (at /t/<name>) in light and dark, through the real viewer
 * daemon, and fail on load or render errors.
 *   node test/e2e/check-templates.ts [screenshot-dir]
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchBrowser } from "./browser.ts";

process.env.PI_ARTIFACTS_DIR ??= mkdtempSync(join(tmpdir(), "pi-artifacts-templates-"));
process.env.PI_ARTIFACTS_PORT ??= "5410";
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });

const { DaemonClient } = await import("../../extension/daemon-client.ts");
const { BUNDLED_TEMPLATES_DIR } = await import("../../shared/paths.ts");

const templates = readdirSync(BUNDLED_TEMPLATES_DIR, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name);
const daemon = new DaemonClient();
const failures: string[] = [];
const browser = await launchBrowser();
try {
	for (const name of templates) {
		for (const theme of ["light", "dark"] as const) {
			const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, colorScheme: theme });
			const errors: string[] = [];
			page.on("pageerror", (e: Error) => errors.push(e.message));
			page.on("console", (m: { type(): string; text(): string }) => {
				// Templates without a pi session show MCP "offline" states; that is expected.
				if (m.type() === "error" && !/No pi session|pi session is connected|MCP/.test(m.text())) errors.push(m.text());
			});
			await page.goto(await daemon.link(`/t/${name}`), { waitUntil: "networkidle" });
			await page.waitForTimeout(1200);
			// Mermaid diagrams must render as SVG (they load lazily).
			if (name === "diagram") {
				await page.locator("[data-mermaid] svg").first().waitFor({ timeout: 20000 }).catch(() => errors.push("no Mermaid SVG rendered"));
			}
			if (await page.getByText(/The artifact failed to load|The artifact crashed while rendering|Could not load the template|Invalid Mermaid diagram/).count()) errors.push(await page.innerText("body"));
			if (shots) await page.screenshot({ path: join(shots, `template-${name}-${theme}.png`), fullPage: true });
			await page.close();
			if (errors.length) failures.push(`${name} (${theme}): ${errors.join(" | ").slice(0, 800)}`);
		}
		console.log(`✓ ${name}`);
	}
} finally {
	await browser.close();
	try {
		const state = JSON.parse(readFileSync(join(process.env.PI_ARTIFACTS_DIR, ".state", "viewer.json"), "utf8"));
		await fetch(`${state.url}/__pi/api/shutdown`, { method: "POST", headers: { "x-pi-artifacts-secret": state.secret } });
	} catch {}
}
if (failures.length) {
	console.error(`\n${failures.length} problem(s):\n${failures.join("\n")}`);
	process.exit(1);
}
console.log("\nAll templates render.");
