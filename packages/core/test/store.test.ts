import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	artifactModuleUrl,
	assertValidId,
	deleteArtifact,
	listArtifacts,
	readCode,
	readMeta,
	slugify,
	writeArtifact,
} from "../src/store.ts";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "pi-artifacts-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("slugify", () => {
	it("makes url-safe ids", () => {
		expect(slugify("Sales Dashboard — Q3!")).toBe("sales-dashboard-q3");
		expect(slugify("  --Hello__World--  ")).toBe("hello-world");
	});
	it("falls back when nothing is left", () => {
		expect(slugify("日本語だけ")).toMatch(/^artifact-[a-z0-9]+$/);
	});
	it("caps the length at 64 without a trailing dash", () => {
		const id = slugify(`${"a".repeat(63)} b`);
		expect(id.length).toBeLessThanOrEqual(64);
		expect(id.endsWith("-")).toBe(false);
	});
});

describe("assertValidId", () => {
	it.each(["../etc", "A", "", "-x", "a/b", "a".repeat(65)])("rejects %j", (id) => {
		expect(() => assertValidId(id)).toThrow();
	});
	it("accepts slugs", () => {
		expect(() => assertValidId("my-artifact-2")).not.toThrow();
	});
});

describe("writeArtifact", () => {
	it("writes code and meta, and keeps createdAt on update", async () => {
		const a = await writeArtifact({ title: "Todo List", code: "export default () => null", cwd: "/p" }, root);
		expect(a.id).toBe("todo-list");
		expect(await readCode("todo-list", root)).toBe("export default () => null");

		await new Promise((r) => setTimeout(r, 5));
		const b = await writeArtifact({ id: "todo-list", title: "Todos", code: "// v2" }, root);
		expect(b.createdAt).toBe(a.createdAt);
		expect(b.updatedAt).toBeGreaterThan(a.updatedAt);
		expect(b.cwd).toBe("/p");
		expect((await readMeta("todo-list", root))?.title).toBe("Todos");
	});

	it("lists newest first and deletes", async () => {
		await writeArtifact({ id: "one", title: "One", code: "" }, root);
		await new Promise((r) => setTimeout(r, 5));
		await writeArtifact({ id: "two", title: "Two", code: "" }, root);
		expect((await listArtifacts(root)).map((a) => a.id)).toEqual(["two", "one"]);
		expect(await deleteArtifact("one", root)).toBe(true);
		expect(await deleteArtifact("one", root)).toBe(false);
		expect((await listArtifacts(root)).map((a) => a.id)).toEqual(["two"]);
	});

	it("returns [] for a missing root", async () => {
		expect(await listArtifacts(join(root, "nope"))).toEqual([]);
	});
});

describe("artifactModuleUrl", () => {
	it("is root-relative inside the viewer and /@fs outside", () => {
		expect(artifactModuleUrl("x", "/v", "/v/artifacts")).toBe("/artifacts/x/index.tsx");
		expect(artifactModuleUrl("x", "/v", "/elsewhere")).toBe("/@fs/elsewhere/x/index.tsx");
	});
});
