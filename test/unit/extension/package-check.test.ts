import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("uses the npm CLI supplied by npm, even when npm is not on PATH", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-package-check-"));
	try {
		const names = ["extension", "shared", "skills", "viewer/server", "viewer/src", "docs/images"];
		for (const name of names) {
			mkdirSync(join(dir, name), { recursive: true });
			writeFileSync(join(dir, name, "sample.ts"), "export {};\n");
		}
		writeFileSync(join(dir, "README.md"), "fixture");
		writeFileSync(join(dir, "LICENSE"), "fixture");
		writeFileSync(join(dir, "package.json"), JSON.stringify({ files: [], pi: { extensions: ["./extension/sample.ts"], skills: ["./skills"] } }));
		const paths = ["package.json", "README.md", "LICENSE", ...names.map((name) => `${name}/sample.ts`)];
		const npmCli = join(dir, "mock npm.cjs");
		writeFileSync(npmCli, `process.stdout.write(${JSON.stringify(JSON.stringify([{ files: paths.map((path) => ({ path })) }]))});`);
		const output = execFileSync(process.execPath, [resolve("scripts/check-package.mjs")], {
			cwd: dir, encoding: "utf8", env: { ...process.env, PATH: dir, npm_execpath: npmCli },
		});
		expect(output).toContain("Package includes 9 required files.");
		writeFileSync(npmCli, `process.stdout.write(${JSON.stringify(JSON.stringify([{ files: paths.filter((path) => path !== "docs/images/sample.ts").map((path) => ({ path })) }]))});`);
		expect(() => execFileSync(process.execPath, [resolve("scripts/check-package.mjs")], {
			cwd: dir, encoding: "utf8", env: { ...process.env, PATH: dir, npm_execpath: npmCli }, stdio: "pipe",
		})).toThrow(/Missing from npm package: docs\/images\/sample\.ts/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
