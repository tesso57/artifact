import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const work = mkdtempSync(join(tmpdir(), "pi-artifacts-pack-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
	const tarball = execFileSync(npm, ["pack", "--silent", "--pack-destination", work], { cwd: root, encoding: "utf8" }).trim().split("\n").pop()!;
	console.log(`packed ${tarball}`);
	writeFileSync(join(work, "package.json"), JSON.stringify({ name: "install-test", private: true }));
	execFileSync(npm, ["install", "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", join(work, tarball)], { cwd: work, stdio: "inherit" });
	const installed = join(work, "node_modules", "pi-artifacts");
	console.log(`installed at ${installed}`);

	const run = spawnSync(process.execPath, [join(root, "test/e2e/run.ts")], {
		stdio: "inherit",
		env: { ...process.env, PI_ARTIFACTS_PACKAGE: installed, PI_ARTIFACTS_PORT: "5430" },
	});
	process.exitCode = run.status ?? 1;
	if (process.exitCode === 0) {
		const projects = spawnSync(process.execPath, [join(root, "test/e2e/project-nested.ts")], {
			stdio: "inherit",
			env: { ...process.env, PI_ARTIFACTS_PACKAGE: installed },
		});
		process.exitCode = projects.status ?? 1;
	}
} finally {
	rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
