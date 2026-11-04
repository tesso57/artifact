import { describe, expect, it } from "vitest";
import { extractViteError, findFreePort } from "../src/viewer.ts";

describe("extractViteError", () => {
	it("reads JSON bodies", () => {
		expect(extractViteError('{"message":"boom"}')).toBe("boom");
	});
	it("reads Vite's JS error page", () => {
		const body = 'export default "x"; const error = {"message":"Failed to resolve import \\"left-pad\\"\\nline2","stack":""}';
		expect(extractViteError(body)).toBe('Failed to resolve import "left-pad"\nline2');
	});
	it("falls back to stripped text", () => {
		expect(extractViteError("<h1>Internal</h1>  <p>oops</p>")).toBe("Internal oops");
	});
});

describe("findFreePort", () => {
	it("returns a usable port", async () => {
		const port = await findFreePort(40000);
		expect(port).toBeGreaterThanOrEqual(40000);
	});
});

import { exportTarget } from "../src/tools/artifact-export.ts";
import { nodeBinary, nodeTsFlags } from "@pi-artifacts/core";

describe("exportTarget", () => {
	it("defaults to <cwd>/<id>.html and resolves relative paths", () => {
		expect(exportTarget("/w", "demo")).toBe("/w/demo.html");
		expect(exportTarget("/w", "demo", "out/x.html")).toBe("/w/out/x.html");
		expect(exportTarget("/w", "demo", "@x.html")).toBe("/w/x.html");
		expect(exportTarget("/w", "demo", "/abs/x.html")).toBe("/abs/x.html");
	});
});

describe("nodeBinary", () => {
	it("uses PI_ARTIFACTS_NODE, else node", () => {
		process.env.PI_ARTIFACTS_NODE = "/opt/node";
		expect(nodeBinary()).toBe("/opt/node");
		delete process.env.PI_ARTIFACTS_NODE;
		expect(nodeBinary()).toMatch(/node/);
		expect(Array.isArray(nodeTsFlags())).toBe(true);
	});
});
