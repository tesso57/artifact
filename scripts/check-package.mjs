import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const args = ["pack", "--dry-run", "--json"];
const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : process.platform === "win32" ? "cmd.exe" : "npm";
const commandArgs = npmCli ? [npmCli, ...args] : process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd", ...args] : args;
const [pack] = JSON.parse(execFileSync(command, commandArgs, { encoding: "utf8" }));
const included = new Set(pack.files.map(({ path }) => path));
function sourceFiles(path) {
	if (!statSync(path).isDirectory()) return [path.replaceAll("\\", "/")];
	return readdirSync(path, { withFileTypes: true }).flatMap((entry) => sourceFiles(join(path, entry.name)));
}
const expected = new Set([
	"package.json", "README.md", "LICENSE",
	...["extension", "shared", "skills", "viewer/server", "viewer/src", "docs/images"].flatMap(sourceFiles),
	...manifest.files.flatMap(sourceFiles),
	...manifest.pi.extensions.map((path) => path.replace(/^\.\//, "")),
	...(manifest.pi.skills ?? []).flatMap((path) => sourceFiles(path.replace(/^\.\//, ""))),
]);
const missing = [...expected].filter((path) => !included.has(path));
if (missing.length) throw new Error(`Missing from npm package: ${missing.join(", ")}`);
console.log(`Package includes ${expected.size} required files.`);
