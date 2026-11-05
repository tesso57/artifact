import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeBinary, nodeTsFlags } from "../../../shared/node.ts";
import { DaemonClient, runtimeRoot } from "../../../extension/daemon-client.ts";
import { exportTarget, formatExport } from "../../../extension/tools/artifact-export.ts";
import { formatWriteResult } from "../../../extension/tools/artifact-write.ts";
import { openerCommand } from "../../../extension/open.ts";

const meta = { id: "x", title: "X", createdAt: 1, updatedAt: 1, mcp: ["gh.*"] };
const base = { meta, created: true, path: "/p/x/index.tsx", url: "http://h/a/x", link: "http://h/__pi/login?t=1", runtimeErrors: [], observed: true };

describe("formatWriteResult", () => {
	it("gives the link, the allowlist, and errors to fix", () => {
		expect(formatWriteResult(base)).toMatch(/Open: http:\/\/h\/__pi\/login\?t=1[\s\S]*MCP allowlist: gh\.\*/);
		expect(formatWriteResult({ ...base, compileError: "Unexpected token" })).toMatch(/Compile error[\s\S]*Unexpected token/);
		expect(formatWriteResult({ ...base, runtimeErrors: [{ message: "x is undefined", at: 1 }] })).toMatch(/runtime errors[\s\S]*x is undefined/);
		expect(formatWriteResult({ ...base, observed: false })).toMatch(/not checked/);
	});
});

describe("exports", () => {
	it("resolves targets and lists what an export embeds", () => {
		expect(exportTarget("/w", "demo")).toBe("/w/demo.html");
		expect(exportTarget("/w", "demo", "@out/x.html")).toBe("/w/out/x.html");
		expect(exportTarget("/w", "demo", "/abs/x.html")).toBe("/abs/x.html");
		const text = formatExport({ file: "/w/d.html", bytes: 2048, embedded: { memoryKeys: ["notes"], sharedKeys: [], mcpCalls: ["a", "b"] } });
		expect(text).toMatch(/2 KB[\s\S]*1 memory key\(s\) \(notes\)[\s\S]*2 MCP result/);
	});
});

describe("node", () => {
	it("picks a Node binary and type-stripping flags", () => {
		process.env.PI_ARTIFACTS_NODE = process.execPath;
		expect(nodeBinary()).toBe(process.execPath);
		delete process.env.PI_ARTIFACTS_NODE;
		expect(Array.isArray(nodeTsFlags())).toBe(true);
		expect(() => nodeTsFlags("/definitely/not/node")).toThrow(/Node\.js 22\.18/);
	});
});

describe("runtimeRoot", () => {
	it("runs in place outside node_modules", () => {
		expect(runtimeRoot("/home/u/src/pi-artifacts")).toBe("/home/u/src/pi-artifacts");
	});

	it("copies the daemon sources out of node_modules and links the dependencies", () => {
		const npmDir = mkdtempSync(join(tmpdir(), "pi-npm-"));
		const pkg = join(npmDir, "node_modules", "pi-artifacts");
		for (const d of ["viewer/server", "viewer/node_modules/junk", "shared", "skills/artifacts/templates/t", "node_modules/nested"]) mkdirSync(join(pkg, d), { recursive: true });
		writeFileSync(join(pkg, "package.json"), '{"version":"9.9.9"}');
		writeFileSync(join(pkg, "tsconfig.base.json"), "{}");
		writeFileSync(join(pkg, "viewer/server/daemon.ts"), "// daemon");
		process.env.PI_ARTIFACTS_RUNTIME = join(npmDir, "runtime");
		try {
			const root = runtimeRoot(pkg);
			expect(root.startsWith(join(npmDir, "runtime"))).toBe(true);
			expect(readFileSync(join(root, "viewer/server/daemon.ts"), "utf8")).toBe("// daemon");
			expect(lstatSync(join(root, "node_modules")).isSymbolicLink()).toBe(true);
			expect(lstatSync(join(root, "viewer", "node_modules")).isSymbolicLink()).toBe(true);
			expect(runtimeRoot(pkg)).toBe(root); // cached
		} finally {
			delete process.env.PI_ARTIFACTS_RUNTIME;
		}
	});
});

describe("openerCommand", () => {
	it("passes the whole URL (with &) as one argument on every platform", () => {
		const url = "http://127.0.0.1:5178/__pi/login?t=abc&next=%2Fa%2Fx";
		expect(openerCommand(url, "win32")).toEqual(["rundll32", ["url.dll,FileProtocolHandler", url]]);
		expect(openerCommand(url, "darwin")).toEqual(["open", [url]]);
		expect(openerCommand(url, "linux")).toEqual(["xdg-open", [url]]);
	});
});

describe("DaemonClient", () => {
	it("background calls never start a viewer", async () => {
		process.env.PI_ARTIFACTS_STATE = mkdtempSync(join(tmpdir(), "pi-state-"));
		try {
			const client = new DaemonClient();
			expect(await client.running()).toBe(false);
			await expect(client.api("/sessions/register", {}, { start: false })).rejects.toThrow(/not running/);
		} finally {
			delete process.env.PI_ARTIFACTS_STATE;
		}
	});
});
