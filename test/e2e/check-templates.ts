/**
 * Render every skill template as a real artifact and fail on compile or page errors.
 *   node test/e2e/check-templates.ts [screenshot-dir]
 */
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = resolve(here, "../../packages/extension/skills/artifacts/templates");
process.env.PI_ARTIFACTS_DIR ??= mkdtempSync(join(tmpdir(), "pi-artifacts-templates-"));
const shots = process.argv[2];

const { artifactModuleUrl, VIEWER_DIR, writeArtifact } = await import("@pi-artifacts/core");
const { Viewer, checkModule } = await import("../../packages/extension/src/viewer.ts");

const templates = readdirSync(templatesDir, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name);
for (const name of templates) {
	await writeArtifact({ id: `template-${name}`, title: name, code: readFileSync(join(templatesDir, name, "template.tsx"), "utf8") });
}

const viewer = new Viewer({ port: 5260 });
const failures: string[] = [];
try {
	const base = await viewer.ensure();
	const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright");
	const browser = await chromium.launch();
	for (const file of templates) {
		const id = `template-${file}`;
		const compileError = await checkModule(base, artifactModuleUrl(id, VIEWER_DIR));
		if (compileError) {
			failures.push(`${file}: ${compileError}`);
			continue;
		}
		for (const theme of ["light", "dark"] as const) {
			const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, colorScheme: theme });
			const errors: string[] = [];
			page.on("pageerror", (e: Error) => errors.push(e.message));
			page.on("console", (m: { type(): string; text(): string }) => {
				if (m.type() === "error" && !m.text().includes("MCP is unavailable")) errors.push(m.text());
			});
			await page.goto(`${base}/a/${id}`, { waitUntil: "networkidle" });
			await page.waitForTimeout(1200);
			const crashed = await page.getByText(/failed to load|crashed while rendering/i).count();
			if (crashed) errors.push(await page.innerText("main, body"));
			if (shots) await page.screenshot({ path: join(shots, `${id}-${theme}.png`), fullPage: true });
			await page.close();
			if (errors.length) failures.push(`${file} (${theme}): ${errors.join(" | ").slice(0, 800)}`);
		}
		console.log(`✓ ${file}`);
	}
	await browser.close();
} finally {
	viewer.stop();
}
if (failures.length) {
	console.error(`\n${failures.length} problem(s):\n${failures.join("\n")}`);
	process.exit(1);
}
console.log("\nAll templates render.");
