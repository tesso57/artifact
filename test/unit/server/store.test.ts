import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertArtifactId, slugify } from "../../../shared/ids.ts";
import { readFile } from "node:fs/promises";
import { deleteArtifact, listArtifacts, readMeta, writeArtifact } from "../../../viewer/server/store.ts";

const readCode = (id: string, root: string) => readFile(join(root, id, "index.tsx"), "utf8");

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
		expect(slugify("Shared")).toBe("artifact-shared");
		expect(slugify("Template MCP Explorer")).toBe("artifact-template-mcp-explorer");
	});
});

describe("assertArtifactId", () => {
	it.each(["../etc", "A", "", "-x", "a/b", "a".repeat(65), "shared", "template-x", undefined, 3])("rejects %j", (id) => {
		expect(() => assertArtifactId(id)).toThrow();
	});
	it("accepts slugs", () => {
		expect(() => assertArtifactId("my-artifact-2")).not.toThrow();
	});
});

describe("writeArtifact", () => {
	it("assigns distinct update versions even when writes share a clock millisecond", async () => {
		const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
		try {
			const first = await writeArtifact({ id: "revision", title: "First", code: "a" }, root);
			const second = await writeArtifact({ id: "revision", title: "Second", code: "b" }, root);
			expect(second.meta.updatedAt).toBeGreaterThan(first.meta.updatedAt);
		} finally { clock.mockRestore(); }
	});
	it("keeps code and metadata consistent when writes to the same artifact overlap", async () => {
		await Promise.all(Array.from({ length: 20 }, (_, i) =>
			writeArtifact({ id: "race", title: `version-${i}`, code: `version-${i}` }, root),
		));
		const meta = await readMeta("race", root);
		expect(await readCode("race", root)).toBe(meta?.title);
	});

	it("applies deletion after an already-started write", async () => {
		const writing = writeArtifact({ id: "race", title: "Race", code: "code" }, root);
		const deleting = deleteArtifact("race", root);
		await writing;
		expect(await deleting).toBe(true);
		expect(await readMeta("race", root)).toBeUndefined();
	});

	it("keeps an identity across updates but assigns a new one after recreation", async () => {
		const first = await writeArtifact({ id: "same", title: "First", code: "" }, root);
		const updated = await writeArtifact({ id: "same", title: "Updated", code: "" }, root);
		expect(first.meta.instanceId).toBeTruthy();
		expect(updated.meta.instanceId).toBe(first.meta.instanceId);
		await deleteArtifact("same", root);
		const recreated = await writeArtifact({ id: "same", title: "New", code: "" }, root);
		expect(recreated.meta.instanceId).not.toBe(first.meta.instanceId);
	});

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

	it("releases a claimed id if creation fails, but keeps a completed write", async () => {
		await expect(writeArtifact({ title: "Clean", code: "first" }, root, { beforeWrite: () => { throw new Error("write failed"); } })).rejects.toThrow("write failed");
		expect((await writeArtifact({ title: "Clean", code: "second" }, root)).meta.id).toBe("clean");
		await expect(writeArtifact({ title: "Saved", code: "saved" }, root, { afterWrite: async () => { throw new Error("check failed"); } })).rejects.toThrow(/artifact "saved" was saved.*check failed/i);
		expect(await readCode("saved", root)).toBe("saved");
		expect(await readMeta("saved", root)).toMatchObject({ title: "Saved" });
	});

	it("restores existing code when metadata cannot be saved", async () => {
		await writeArtifact({ id: "keep", title: "Original", code: "original code" }, root);
		const obstruction = join(root, "keep", `meta.json.${process.pid}.tmp`);
		await mkdir(obstruction);
		await expect(writeArtifact({ id: "keep", title: "Replacement", code: "replacement code" }, root)).rejects.toThrow();
		expect(await readCode("keep", root)).toBe("original code");
		expect((await readMeta("keep", root))?.title).toBe("Original");
	});

	it("does not write through a symbolic-link entry or artifact directory", async () => {
		const victim = join(root, "victim.txt");
		await writeFile(victim, "keep");
		await mkdir(join(root, "linked"));
		try {
			await symlink(victim, join(root, "linked", "index.tsx"), "file");
		} catch (error) {
			if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
			throw error;
		}
		await expect(writeArtifact({ id: "linked", title: "Linked", code: "overwrite" }, root)).rejects.toThrow(/symbolic link/i);
		expect(await readFile(victim, "utf8")).toBe("keep");
		const outside = join(root, "victim-dir");
		await mkdir(outside);
		await writeFile(join(outside, "index.tsx"), "keep directory");
		await symlink(outside, join(root, "linked-dir"), process.platform === "win32" ? "junction" : "dir");
		await expect(writeArtifact({ id: "linked-dir", title: "Linked", code: "overwrite" }, root)).rejects.toThrow(/symbolic link/i);
		expect(await readFile(join(outside, "index.tsx"), "utf8")).toBe("keep directory");
	});

	it("does not write through a pre-existing temporary metadata symlink", async () => {
		await writeArtifact({ id: "meta-link", title: "Original", code: "original" }, root);
		const victim = join(root, "metadata-victim.txt");
		await writeFile(victim, "keep");
		const temporary = join(root, "meta-link", `meta.json.${process.pid}.tmp`);
		try { await symlink(victim, temporary, "file"); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		await expect(writeArtifact({ id: "meta-link", title: "New", code: "new" }, root)).rejects.toThrow();
		expect(await readFile(victim, "utf8")).toBe("keep");
		expect(await readCode("meta-link", root)).toBe("original");
	});

	it("holds a claimed id until its post-write checks finish", async () => {
		let release!: () => void;
		let checking!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const started = new Promise<void>((resolve) => { checking = resolve; });
		const first = writeArtifact({ title: "Report", code: "first" }, root, { afterWrite: async () => { checking(); await gate; } });
		let second: Promise<unknown> | undefined;
		try {
			await started;
			second = writeArtifact({ id: "report", title: "Replacement", code: "second" }, root);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(await readCode("report", root)).toBe("first");
		} finally {
			release();
			await Promise.allSettled([first, ...(second ? [second] : [])]);
		}
		expect((await first).created).toBe(true);
		expect(await readCode("report", root)).toBe("second");
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

	it("reports when files were deleted but post-delete cleanup failed", async () => {
		await writeArtifact({ id: "partial-delete", title: "Test", code: "source" }, root);
		await expect(deleteArtifact("partial-delete", root, () => { throw new Error("database unavailable"); })).rejects.toThrow(/artifact "partial-delete" files were deleted.*cleanup failed.*database unavailable/i);
		await expect(readCode("partial-delete", root)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("skips malformed metadata and IDs that do not match their directory", async () => {
		await writeArtifact({ id: "valid", title: "Valid", code: "" }, root);
		const cases: Record<string, unknown> = {
			mismatch: { id: "valid", title: "Wrong ID", createdAt: 1, updatedAt: 1 },
			badtitle: { id: "badtitle", title: { text: "not a string" }, createdAt: 1, updatedAt: 1 },
			badmcp: { id: "badmcp", title: "Bad MCP", createdAt: 1, updatedAt: 1, mcp: [42] },
			badtime: { id: "badtime", title: "Bad date", createdAt: 1, updatedAt: "today" },
		};
		for (const [name, meta] of Object.entries(cases)) {
			await mkdir(join(root, name));
			await writeFile(join(root, name, "meta.json"), JSON.stringify(meta));
		}
		expect((await listArtifacts(root)).map((meta) => meta.id)).toEqual(["valid"]);
		for (const name of Object.keys(cases)) expect(await readMeta(name, root)).toBeUndefined();
	});

	it("does not overwrite existing code when its metadata is invalid", async () => {
		await writeArtifact({ id: "damaged", title: "Original", code: "original source" }, root);
		const metadata = join(root, "damaged", "meta.json");
		await writeFile(metadata, '{"id":"different"}');
		await expect(writeArtifact({ id: "damaged", title: "Replacement", code: "new source" }, root)).rejects.toThrow(/metadata/i);
		expect(await readCode("damaged", root)).toBe("original source");
		expect(await readFile(metadata, "utf8")).toBe('{"id":"different"}');
	});

	it("does not overwrite an existing source file without metadata", async () => {
		await mkdir(join(root, "orphan"));
		await writeFile(join(root, "orphan", "index.tsx"), "orphan source");
		await expect(writeArtifact({ id: "orphan", title: "Replacement", code: "new source" }, root)).rejects.toThrow(/metadata/i);
		expect(await readCode("orphan", root)).toBe("orphan source");
	});

	it("does not read artifact metadata through a symbolic link", async () => {
		await writeArtifact({ id: "linked-meta", title: "Original", code: "source" }, root);
		const metadata = join(root, "linked-meta", "meta.json");
		const external = join(root, "external.json");
		await writeFile(external, await readFile(metadata));
		await rm(metadata);
		try { await symlink(external, metadata); }
		catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
		expect(await readMeta("linked-meta", root)).toBeUndefined();
		expect(await listArtifacts(root)).toEqual([]);
	});

	it("returns [] for a missing root", async () => {
		expect(await listArtifacts(join(root, "nope"))).toEqual([]);
	});
});
