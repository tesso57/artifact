import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeBinary, nodeTsFlags } from "../../../shared/node.ts";
import { compatible, DaemonClient, runtimeRoot } from "../../../extension/daemon-client.ts";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PROTOCOL_VERSION } from "../../../shared/protocol.ts";
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

describe("daemon compatibility", () => {
	const ours = (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version;
	const bump = (v: string, d: number) => v.split(".").map((n, i) => (i === 1 ? Math.max(0, Number(n) + d) : i === 2 ? 0 : Number(n))).join(".");

	it("uses daemons of the same protocol that are not older, never older or other protocols", () => {
		expect(compatible({ protocol: PROTOCOL_VERSION, version: ours })).toBe(true);
		expect(compatible({ protocol: PROTOCOL_VERSION, version: bump(ours, 1) })).toBe(true);
		expect(compatible({ protocol: PROTOCOL_VERSION, version: "0.0.1" })).toBe(false);
		expect(compatible({ protocol: PROTOCOL_VERSION + 1, version: bump(ours, 1) })).toBe(false);
		expect(compatible(undefined)).toBe(false);
	});

	it("finds a running daemon through the state file, and re-reads it for background calls", async () => {
		const state = mkdtempSync(join(tmpdir(), "pi-state-"));
		let secret = "s1";
		const server = createServer((req, res) => {
			if (req.headers["x-pi-artifacts-secret"] !== secret) {
				res.statusCode = 401;
				return res.end("{}");
			}
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(req.url === "/__pi/api/health" ? { protocol: PROTOCOL_VERSION, version: ours } : { ok: true }));
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		const writeState = () => writeFileSync(join(state, "viewer.json"), JSON.stringify({ protocol: PROTOCOL_VERSION, pid: 1, port: 0, url, secret, version: ours, startedAt: 0 }));
		process.env.PI_ARTIFACTS_STATE = state;
		try {
			writeState();
			const client = new DaemonClient();
			expect(await client.running()).toBe(true);
			expect(await client.api("/sessions/register", {}, { start: false })).toEqual({ ok: true });
			// The daemon is replaced (new secret): the next background call picks it up.
			secret = "s2";
			writeState();
			expect(await client.api("/sessions/register", {}, { start: false })).toEqual({ ok: true });
		} finally {
			delete process.env.PI_ARTIFACTS_STATE;
			await new Promise((r) => server.close(r));
		}
	});
});
