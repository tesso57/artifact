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
