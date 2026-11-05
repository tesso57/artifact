import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertArtifactId, slugify } from "../../../shared/ids.ts";
import { deleteArtifact, listArtifacts, readCode, readMeta, writeArtifact } from "../../../viewer/server/store.ts";

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
	it("falls back when nothing is left, and avoids reserved ids", () => {
		expect(slugify("日本語だけ")).toMatch(/^artifact-[a-z0-9]+$/);
		expect(slugify("Shared")).toBe("shared-artifact");
	});
});

describe("assertArtifactId", () => {
	it.each(["../etc", "A", "", "-x", "a/b", "a".repeat(65), "shared", undefined, 3])("rejects %j", (id) => {
		expect(() => assertArtifactId(id)).toThrow();
	});
	it("accepts slugs", () => {
		expect(() => assertArtifactId("my-artifact-2")).not.toThrow();
	});
});

describe("writeArtifact", () => {
	it("writes code and meta, and keeps createdAt, cwd, session and mcp on update", async () => {
		const a = await writeArtifact({ title: "Todo List", code: "v1", cwd: "/p", sessionId: "s1", mcp: ["gh.*"] }, root);
		expect(a).toMatchObject({ created: true, meta: { id: "todo-list" } });
		expect(await readCode("todo-list", root)).toBe("v1");

		await new Promise((r) => setTimeout(r, 5));
		const b = await writeArtifact({ id: "todo-list", title: "Todos", code: "v2" }, root);
		expect(b.created).toBe(false);
		expect(b.meta).toMatchObject({ createdAt: a.meta.createdAt, cwd: "/p", sessionId: "s1", mcp: ["gh.*"], title: "Todos" });
		expect(b.meta.updatedAt).toBeGreaterThan(a.meta.updatedAt);
	});

	it("never overwrites when no id is given: same titles get new ids", async () => {
		const ids = [];
		for (let i = 0; i < 3; i++) ids.push((await writeArtifact({ title: "Report", code: `v${i}` }, root)).meta.id);
		expect(ids).toEqual(["report", "report-2", "report-3"]);
		expect(await readCode("report", root)).toBe("v0");
	});

	it("lists newest first, ignores junk folders, and deletes", async () => {
		await writeArtifact({ id: "one", title: "One", code: "" }, root);
		await new Promise((r) => setTimeout(r, 5));
		await writeArtifact({ id: "two", title: "Two", code: "" }, root);
		expect((await listArtifacts(root)).map((a) => a.id)).toEqual(["two", "one"]);
		expect(await deleteArtifact("one", root)).toBe(true);
		expect(await deleteArtifact("one", root)).toBe(false);
		expect(await readMeta("one", root)).toBeUndefined();
	});

	it("returns [] for a missing root", async () => {
		expect(await listArtifacts(join(root, "nope"))).toEqual([]);
	});
});
