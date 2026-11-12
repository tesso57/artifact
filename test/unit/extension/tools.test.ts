import { chmodSync, existsSync, fstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { nodeBinary, nodeTsFlags, runtimeNeedsPreserveSymlinks } from "../../../shared/node.ts";
import { compatible, DaemonClient, runtimeRoot } from "../../../extension/daemon-client.ts";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { compareVersions, PROTOCOL_VERSION } from "../../../shared/protocol.ts";
import { exportTarget, formatExport } from "../../../extension/tools/artifact-export.ts";
import { formatWriteResult, registerArtifactWrite } from "../../../extension/tools/artifact-write.ts";
import { openInBrowser, openerCommand } from "../../../extension/open.ts";
import { registerArtifactsCommand } from "../../../extension/command.ts";
import { createMockPi } from "../../helpers/mock-pi.ts";
import { pathToFileURL } from "node:url";

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
		const cwd = resolve("w");
		const absolute = resolve("abs", "x.html");
		expect(exportTarget(cwd, "demo")).toBe(join(cwd, "demo.html"));
		expect(exportTarget(cwd, "demo", "@out/x.html")).toBe(join(cwd, "out", "x.html"));
		expect(exportTarget(cwd, "demo", absolute)).toBe(absolute);
		const text = formatExport({ file: "/w/d.html", bytes: 2048, embedded: { memoryKeys: ["notes"], sharedKeys: [], mcpCalls: ['mcp__example__read {"project":"alpha"}', 'mcp__example__read {"project":"beta"}'] } });
		expect(text).toMatch(/2 KB[\s\S]*1 memory key\(s\) \(notes\)[\s\S]*2 MCP result/);
		expect(text).toContain('mcp__example__read {"project":"alpha"}');
		expect(text).toContain('mcp__example__read {"project":"beta"}');
	});
});

describe("node", () => {
	it("picks a Node binary and type-stripping flags", () => {
		process.env.PI_ARTIFACTS_NODE = process.execPath;
		expect(nodeBinary()).toBe(process.execPath);
		delete process.env.PI_ARTIFACTS_NODE;
		expect(Array.isArray(nodeTsFlags())).toBe(true);
		expect(() => nodeTsFlags("/definitely/not/node")).toThrow(/Node\.js 22\.19/);
	});

	it.skipIf(process.platform === "win32")("enforces the declared minimum and selects flags for Node 23", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-node-version-"));
		const binary = join(dir, "fake-node");
		const version = (value: string) => {
			writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' '${value}'\n`);
			chmodSync(binary, 0o755);
			return () => nodeTsFlags(binary);
		};
		try {
			expect(version("22.18.0")).toThrow(/22\.19/);
			expect(version("22.19.0")()).not.toContain("--experimental-strip-types");
			expect(version("23.0.0")()).toEqual(expect.arrayContaining(["--experimental-strip-types", "--experimental-sqlite"]));
			expect(version("23.4.0")()).toContain("--experimental-strip-types");
			expect(version("23.4.0")()).not.toContain("--experimental-sqlite");
			expect(version("23.6.0")()).not.toContain("--experimental-strip-types");
		} finally { rmSync(dir, { recursive: true, force: true }); }
	});

	it.skipIf(process.platform === "win32")("does not wait indefinitely for an unresponsive Node binary", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-node-timeout-"));
		try {
			const binary = join(dir, "unresponsive-node");
			writeFileSync(binary, "#!/bin/sh\ntrap '' TERM\nexec /bin/sleep 9\n");
			chmodSync(binary, 0o755);
			const start = performance.now();
			expect(() => nodeTsFlags(binary)).toThrow(/Cannot run/);
			expect(performance.now() - start).toBeLessThan(7500);
		} finally { rmSync(dir, { recursive: true, force: true }); }
	}, 15_000);

	it.skipIf(process.platform === "win32")("does not accept version output from a failed probe", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-node-failure-"));
		try {
			const binary = join(dir, "failing-node");
			writeFileSync(binary, "#!/bin/sh\nprintf '99.0.0\\n'\nexit 1\n");
			chmodSync(binary, 0o755);
			expect(() => nodeTsFlags(binary)).toThrow(/Cannot run/);
		} finally { rmSync(dir, { recursive: true, force: true }); }
	});

	it("detects dependencies whose real path contains URL delimiters", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-node-deps-"));
		const runtime = join(dir, "runtime");
		const target = join(dir, "dependencies # %");
		mkdirSync(runtime);
		mkdirSync(target);
		try {
			expect(runtimeNeedsPreserveSymlinks(runtime)).toBe(false);
			try { symlinkSync(target, join(runtime, "node_modules"), process.platform === "win32" ? "junction" : "dir"); }
			catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
			expect(runtimeNeedsPreserveSymlinks(runtime)).toBe(true);
		} finally { rmSync(dir, { recursive: true, force: true }); }
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

	it("places runtime copies in a Vite-safe path when the configured runtime path contains URL delimiters", () => {
		const npmDir = mkdtempSync(join(tmpdir(), "pi-npm-#%-"));
		const pkg = join(npmDir, "node_modules", "pi-artifacts");
		for (const d of ["viewer/server", "shared", "skills/artifacts/templates/t"]) mkdirSync(join(pkg, d), { recursive: true });
		writeFileSync(join(pkg, "package.json"), '{"version":"9.9.9"}');
		writeFileSync(join(pkg, "tsconfig.base.json"), "{}");
		writeFileSync(join(pkg, "viewer/server/daemon.ts"), "// daemon");
		process.env.PI_ARTIFACTS_RUNTIME = join(npmDir, "runtime #%");
		let copied: string | undefined;
		try {
			copied = runtimeRoot(pkg);
			expect(copied).not.toMatch(/[#?%]/);
			expect(readFileSync(join(copied, "viewer/server/daemon.ts"), "utf8")).toBe("// daemon");
			expect(runtimeRoot(pkg)).toBe(copied);
		} finally {
			delete process.env.PI_ARTIFACTS_RUNTIME;
			const parent = copied && dirname(copied);
			if (parent && dirname(parent) === resolve(tmpdir()) && basename(parent).startsWith("pi-artifacts-runtime-")) rmSync(parent, { recursive: true, force: true });
			rmSync(npmDir, { recursive: true, force: true });
		}
	});

	it("does not reuse a runtime linked to a different installation", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-two-installs-"));
		const makePackage = (name: string) => {
			const pkg = join(dir, name, "node_modules", "pi-artifacts");
			for (const d of ["viewer/server", "shared", "skills/artifacts/templates/t"]) mkdirSync(join(pkg, d), { recursive: true });
			writeFileSync(join(pkg, "package.json"), '{"version":"9.9.9"}');
			writeFileSync(join(pkg, "tsconfig.base.json"), "{}");
			writeFileSync(join(pkg, "viewer/server/daemon.ts"), "// daemon");
			return pkg;
		};
		const first = makePackage("first");
		const second = makePackage("second");
		process.env.PI_ARTIFACTS_RUNTIME = join(dir, "runtime");
		try {
			const a = runtimeRoot(first);
			const b = runtimeRoot(second);
			expect(a).not.toBe(b);
			expect(realpathSync(join(a, "node_modules"))).toBe(realpathSync(join(first, "..")));
			expect(realpathSync(join(b, "node_modules"))).toBe(realpathSync(join(second, "..")));
		} finally {
			delete process.env.PI_ARTIFACTS_RUNTIME;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("links hoisted dependencies for a source checkout under a special path", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-workspace-"));
		const root = join(dir, "source #");
		const dependencies = join(dir, "node_modules");
		for (const part of ["viewer/server", "shared", "skills/artifacts/templates/t"]) mkdirSync(join(root, part), { recursive: true });
		mkdirSync(join(dependencies, "vite"), { recursive: true });
		writeFileSync(join(dependencies, "vite", "package.json"), '{"name":"vite","version":"1.0.0"}');
		writeFileSync(join(root, "package.json"), '{"version":"9.9.9"}');
		writeFileSync(join(root, "tsconfig.base.json"), "{}");
		writeFileSync(join(root, "viewer/server/daemon.ts"), "// daemon");
		process.env.PI_ARTIFACTS_RUNTIME = join(dir, "runtime");
		try {
			const runtime = runtimeRoot(root);
			expect(existsSync(join(runtime, "node_modules"))).toBe(true);
			expect(realpathSync(join(runtime, "node_modules"))).toBe(realpathSync(dependencies));
		} finally {
			delete process.env.PI_ARTIFACTS_RUNTIME;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reports a failed runtime finalization instead of returning an unusable path", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-runtime-obstruction-"));
		const pkg = join(dir, "node_modules", "pi-artifacts");
		for (const part of ["viewer/server", "shared", "skills/artifacts/templates/t"]) mkdirSync(join(pkg, part), { recursive: true });
		writeFileSync(join(pkg, "package.json"), '{"version":"9.9.9"}');
		writeFileSync(join(pkg, "tsconfig.base.json"), "{}");
		writeFileSync(join(pkg, "viewer/server/daemon.ts"), "// daemon");
		process.env.PI_ARTIFACTS_RUNTIME = join(dir, "runtime");
		try {
			const target = runtimeRoot(pkg);
			rmSync(target, { recursive: true, force: true });
			writeFileSync(target, "obstruction");
			expect(() => runtimeRoot(pkg)).toThrow(/runtime/i);
			expect(readFileSync(target, "utf8")).toBe("obstruction");
		} finally {
			delete process.env.PI_ARTIFACTS_RUNTIME;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("removes its temporary copy when a required runtime source is missing", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-runtime-copy-fail-"));
		const pkg = join(dir, "node_modules", "pi-artifacts");
		for (const part of ["viewer/server", "shared"]) mkdirSync(join(pkg, part), { recursive: true });
		writeFileSync(join(pkg, "package.json"), '{"version":"9.9.9"}');
		writeFileSync(join(pkg, "tsconfig.base.json"), "{}");
		process.env.PI_ARTIFACTS_RUNTIME = join(dir, "runtime");
		try {
			expect(() => runtimeRoot(pkg)).toThrow();
			expect(readdirSync(join(dir, "runtime"))).toEqual([]);
		} finally {
			delete process.env.PI_ARTIFACTS_RUNTIME;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("checks the real parent when a safe-looking runtime path is a symlink", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-runtime-link-"));
		const special = join(dir, "physical # %");
		const alias = join(dir, "alias");
		const pkg = join(dir, "node_modules", "pi-artifacts");
		mkdirSync(special);
		for (const d of ["viewer/server", "shared", "skills/artifacts/templates/t"]) mkdirSync(join(pkg, d), { recursive: true });
		writeFileSync(join(pkg, "package.json"), '{"version":"9.9.9"}');
		writeFileSync(join(pkg, "tsconfig.base.json"), "{}");
		writeFileSync(join(pkg, "viewer/server/daemon.ts"), "// daemon");
		try { symlinkSync(special, alias, process.platform === "win32" ? "junction" : "dir"); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) { rmSync(dir, { recursive: true, force: true }); return; } throw error; }
		process.env.PI_ARTIFACTS_RUNTIME = join(alias, "runtime");
		let copied: string | undefined;
		try {
			copied = runtimeRoot(pkg);
			expect(realpathSync(copied)).not.toMatch(/[#?%]/);
		} finally {
			delete process.env.PI_ARTIFACTS_RUNTIME;
			const parent = copied && dirname(copied);
			if (parent && dirname(parent) === resolve(tmpdir()) && basename(parent).startsWith("pi-artifacts-runtime-")) rmSync(parent, { recursive: true, force: true });
			rmSync(dir, { recursive: true, force: true });
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

	it.skipIf(process.platform === "win32")("reports when the browser opener executable is unavailable", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-no-opener-"));
		const previous = process.env.PATH;
		try {
			process.env.PATH = dir;
			expect(await openInBrowser("http://127.0.0.1:1234/__pi/login?t=test")).toBe(false);
		} finally {
			if (previous === undefined) delete process.env.PATH;
			else process.env.PATH = previous;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === "win32")("reports an opener that exits with an error", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-bad-opener-"));
		const previous = process.env.PATH;
		try {
			const binary = join(dir, process.platform === "darwin" ? "open" : "xdg-open");
			writeFileSync(binary, "#!/bin/sh\nexit 1\n");
			chmodSync(binary, 0o755);
			process.env.PATH = dir;
			expect(await openInBrowser("http://127.0.0.1:1234/__pi/login?t=test")).toBe(false);
		} finally {
			if (previous === undefined) delete process.env.PATH;
			else process.env.PATH = previous;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === "win32")("shows the usable link if the browser opener cannot start", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-no-opener-"));
		const previous = process.env.PATH;
		const link = "http://127.0.0.1:1234/__pi/login?t=test";
		const mock = createMockPi();
		mock.context.hasUI = false;
		const runtime = { attach: () => {}, connect: async () => {}, daemon: { url: "http://127.0.0.1:1234", link: async () => link } };
		try {
			process.env.PATH = dir;
			registerArtifactsCommand(mock.pi, runtime as never);
			await mock.runCommand("artifacts");
			expect(mock.notifications).toContainEqual({ message: link, type: "info" });
		} finally {
			if (previous === undefined) delete process.env.PATH;
			else process.env.PATH = previous;
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("DaemonClient", () => {
	it.skipIf(process.platform === "win32")("reports a spawn error instead of crashing when Node disappears after validation", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-spawn-error-"));
		try {
			const binary = join(dir, "node-once");
			writeFileSync(binary, '#!/bin/sh\n/bin/rm "$0"\nprintf "26.0.0\\n"\n');
			chmodSync(binary, 0o755);
			const moduleUrl = pathToFileURL(resolve("extension/daemon-client.ts")).href;
			const script = `import { DaemonClient } from ${JSON.stringify(moduleUrl)}; try { await new DaemonClient().ensure(); process.exitCode = 2; } catch (error) { console.log("caught:", error.message); }`;
			const child = spawnSync(process.execPath, [...nodeTsFlags(process.execPath), "--input-type=module", "-e", script], {
				env: { ...process.env, PI_ARTIFACTS_STATE: join(dir, "state"), PI_ARTIFACTS_NODE: binary }, encoding: "utf8", timeout: 8000,
			});
			expect(child.status, child.stderr).toBe(0);
			expect(child.stdout).toMatch(/caught:.*(start|spawn)/i);
		} finally { rmSync(dir, { recursive: true, force: true }); }
	}, 15_000);
	it.skipIf(process.platform === "win32")("closes the log descriptor when the configured Node binary cannot start", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-state-"));
		process.env.PI_ARTIFACTS_STATE = dir;
		process.env.PI_ARTIFACTS_NODE = join(dir, "missing-node");
		try {
			await expect(new DaemonClient().ensure()).rejects.toThrow(/Cannot run/);
			const log = statSync(join(dir, "viewer.log"));
			const fdDir = process.platform === "linux" ? "/proc/self/fd" : "/dev/fd";
			const openLogs = readdirSync(fdDir).filter((name) => {
				try { const fd = fstatSync(Number(name)); return fd.dev === log.dev && fd.ino === log.ino; }
				catch { return false; }
			});
			expect(openLogs).toEqual([]);
		} finally {
			delete process.env.PI_ARTIFACTS_STATE;
			delete process.env.PI_ARTIFACTS_NODE;
			rmSync(dir, { recursive: true, force: true });
		}
	});
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

	it("distinguishes the released 0.3 daemon from the updated runtime", () => {
		expect(PROTOCOL_VERSION).not.toBe(1);
		expect(compatible({ protocol: 1, version: "0.3.0" })).toBe(false);
		expect(compareVersions(ours, "0.3.0")).toBeGreaterThan(0);
	});

	it("replaces an older viewer but never shuts down a newer incompatible viewer", async () => {
		const state = mkdtempSync(join(tmpdir(), "pi-upgrade-test-"));
		let health = { protocol: 1, version: "0.3.0" };
		let stopped = false;
		let shutdowns = 0;
		const server = createServer((req, res) => {
			if (req.url === "/__pi/api/shutdown") {
				shutdowns++;
				stopped = true;
				res.end("{}");
			} else {
				res.statusCode = stopped ? 503 : 200;
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify(health));
			}
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const port = (server.address() as AddressInfo).port;
		process.env.PI_ARTIFACTS_STATE = state;
		const viewer = { protocol: PROTOCOL_VERSION, pid: 1, port, url: `http://127.0.0.1:${port}`, secret: "secret", version: ours, startedAt: 0 };
		writeFileSync(join(state, "viewer.json"), JSON.stringify({ ...viewer, ...health }));
		try {
			const client = new DaemonClient();
			const spawn = vi.spyOn(client as unknown as { spawn: () => Promise<typeof viewer> }, "spawn").mockResolvedValue(viewer);
			expect(await client.ensure()).toEqual(viewer);
			expect(shutdowns).toBe(1);
			expect(spawn).toHaveBeenCalledOnce();
			health = { protocol: PROTOCOL_VERSION, version: "0.4.0" };
			stopped = false;
			const unpatched = new DaemonClient();
			const replacement = vi.spyOn(unpatched as unknown as { spawn: () => Promise<typeof viewer> }, "spawn").mockResolvedValue(viewer);
			expect(await unpatched.ensure()).toEqual(viewer);
			expect(shutdowns).toBe(2);
			expect(replacement).toHaveBeenCalledOnce();
			health = { protocol: PROTOCOL_VERSION + 1, version: bump(ours, 1) };
			stopped = false;
			await expect(new DaemonClient().ensure()).rejects.toThrow(/newer, incompatible/);
			expect(shutdowns).toBe(2);
		} finally {
			delete process.env.PI_ARTIFACTS_STATE;
			await new Promise<void>((done) => server.close(() => done()));
			rmSync(state, { recursive: true, force: true });
		}
	});

	it("uses daemons of the same protocol that are not older, never older or other protocols", () => {
		expect(compatible({ protocol: PROTOCOL_VERSION, version: ours })).toBe(true);
		expect(compatible({ protocol: PROTOCOL_VERSION, version: bump(ours, 1) })).toBe(true);
		expect(compatible({ protocol: PROTOCOL_VERSION, version: "0.0.1" })).toBe(false);
		expect(compatible({ protocol: PROTOCOL_VERSION + 1, version: bump(ours, 1) })).toBe(false);
		expect(compatible(undefined)).toBe(false);
	});

	it("does not reuse the 0.2.0 viewer that lacks the new content blocks", () => {
		expect(compatible({ protocol: PROTOCOL_VERSION, version: "0.2.0" })).toBe(false);
	});

	it("does not reuse an unpatched 0.4.0 viewer after the security update", () => {
		expect(compatible({ protocol: PROTOCOL_VERSION, version: "0.4.0" })).toBe(false);
	});

	it("does not reuse a prerelease viewer for the corresponding release", () => {
		expect(compatible({ protocol: PROTOCOL_VERSION, version: `${ours}-rc.1` })).toBe(false);
	});

	it("rejects incomplete and malformed daemon health responses", () => {
		for (const response of [{ protocol: PROTOCOL_VERSION }, { protocol: PROTOCOL_VERSION, version: null }, { protocol: PROTOCOL_VERSION, version: "999broken" }]) {
			expect(compatible(response as never)).toBe(false);
		}
	});

	it("treats a daemon with malformed health JSON as unavailable", async () => {
		const state = mkdtempSync(join(tmpdir(), "pi-state-"));
		const server = createServer((_req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ protocol: PROTOCOL_VERSION, version: null }));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		process.env.PI_ARTIFACTS_STATE = state;
		writeFileSync(join(state, "viewer.json"), JSON.stringify({ protocol: PROTOCOL_VERSION, pid: 1, port, url: `http://127.0.0.1:${port}`, secret: "secret", version: ours, startedAt: 0 }));
		try {
			expect(await new DaemonClient().running()).toBe(false);
		} finally {
			delete process.env.PI_ARTIFACTS_STATE;
			await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(state, { recursive: true, force: true });
		}
	});

	it("does not repeat a POST after the server receives it and the connection drops", async () => {
		const state = mkdtempSync(join(tmpdir(), "pi-state-"));
		let writes = 0;
		const server = createServer((req, res) => {
			if (req.url === "/__pi/api/health") {
				res.setHeader("content-type", "application/json");
				return res.end(JSON.stringify({ protocol: PROTOCOL_VERSION, version: ours }));
			}
			writes++;
			if (writes === 1) return req.socket.destroy();
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ ok: true }));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		process.env.PI_ARTIFACTS_STATE = state;
		writeFileSync(join(state, "viewer.json"), JSON.stringify({ protocol: PROTOCOL_VERSION, pid: 1, port, url: `http://127.0.0.1:${port}`, secret: "secret", version: ours, startedAt: 0 }));
		try {
			await expect(new DaemonClient().api("/artifacts/write", { title: "test" })).rejects.toThrow(/outcome|result/i);
			expect(writes).toBe(1);
		} finally {
			delete process.env.PI_ARTIFACTS_STATE;
			await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(state, { recursive: true, force: true });
		}
	});

	it("does not report success for an unreadable response after a POST", async () => {
		const state = mkdtempSync(join(tmpdir(), "pi-state-"));
		const server = createServer((req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(req.url === "/__pi/api/health" ? JSON.stringify({ protocol: PROTOCOL_VERSION, version: ours }) : "{");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		process.env.PI_ARTIFACTS_STATE = state;
		writeFileSync(join(state, "viewer.json"), JSON.stringify({ protocol: PROTOCOL_VERSION, pid: 1, port, url: `http://127.0.0.1:${port}`, secret: "secret", version: ours, startedAt: 0 }));
		try {
			await expect(new DaemonClient().api("/artifacts/write", { title: "test" })).rejects.toThrow(/outcome|result/i);
		} finally {
			delete process.env.PI_ARTIFACTS_STATE;
			await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(state, { recursive: true, force: true });
		}
	});

	it("still retries a GET when the connection drops", async () => {
		const state = mkdtempSync(join(tmpdir(), "pi-state-"));
		let reads = 0;
		const server = createServer((req, res) => {
			if (req.url !== "/__pi/api/health" && ++reads === 1) return req.socket.destroy();
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(req.url === "/__pi/api/health" ? { protocol: PROTOCOL_VERSION, version: ours } : { ok: true }));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		process.env.PI_ARTIFACTS_STATE = state;
		writeFileSync(join(state, "viewer.json"), JSON.stringify({ protocol: PROTOCOL_VERSION, pid: 1, port, url: `http://127.0.0.1:${port}`, secret: "secret", version: ours, startedAt: 0 }));
		try {
			expect(await new DaemonClient().api("/artifacts")).toEqual({ ok: true });
			expect(reads).toBe(2);
		} finally {
			delete process.env.PI_ARTIFACTS_STATE;
			await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(state, { recursive: true, force: true });
		}
	});

	it("honors a shorter timeout for a session registration", async () => {
		const state = mkdtempSync(join(tmpdir(), "pi-state-"));
		const server = createServer((req, res) => {
			res.setHeader("content-type", "application/json");
			if (req.url === "/__pi/api/health") return res.end(JSON.stringify({ protocol: PROTOCOL_VERSION, version: ours }));
			setTimeout(() => res.end(JSON.stringify({ ok: true })), 250);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		process.env.PI_ARTIFACTS_STATE = state;
		writeFileSync(join(state, "viewer.json"), JSON.stringify({ protocol: PROTOCOL_VERSION, pid: 1, port, url: `http://127.0.0.1:${port}`, secret: "secret", version: ours, startedAt: 0 }));
		try {
			await expect(new DaemonClient().api("/sessions/register", {}, { start: false, timeoutMs: 40 })).rejects.toThrow();
		} finally {
			delete process.env.PI_ARTIFACTS_STATE;
			await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(state, { recursive: true, force: true });
		}
	});

	it("identifies a timed-out POST while preserving the unknown-outcome warning", async () => {
		const state = mkdtempSync(join(tmpdir(), "pi-state-"));
		let writes = 0;
		const server = createServer((req, res) => {
			res.setHeader("content-type", "application/json");
			if (req.url === "/__pi/api/health") return res.end(JSON.stringify({ protocol: PROTOCOL_VERSION, version: ours }));
			writes++;
			setTimeout(() => res.end(JSON.stringify({ ok: true })), 250);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		process.env.PI_ARTIFACTS_STATE = state;
		writeFileSync(join(state, "viewer.json"), JSON.stringify({ protocol: PROTOCOL_VERSION, pid: 1, port, url: `http://127.0.0.1:${port}`, secret: "secret", version: ours, startedAt: 0 }));
		try {
			let execute!: (id: string, params: { title: string; code: string }, signal: undefined, update: undefined, context: unknown) => Promise<{ isError: boolean; content: { text: string }[] }>;
			const client = new DaemonClient();
			registerArtifactWrite({ registerTool: (tool: { execute: typeof execute }) => { execute = tool.execute; } } as never, {
				captureToolContext: () => {}, connect: async () => {}, id: "session",
				daemon: { api: (path: string, body: unknown) => client.api(path, body, { timeoutMs: 40 }) },
			} as never);
			const result = await execute("call", { title: "test", code: "" }, undefined, undefined, { cwd: state });
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toMatch(/timed out.*40.*may have completed/i);
			expect(writes).toBe(1);
		} finally {
			delete process.env.PI_ARTIFACTS_STATE;
			await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(state, { recursive: true, force: true });
		}
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
