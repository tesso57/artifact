import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { artifactsDir, daemonStatePath, memoryDbPath, runtimeDir, stateDir } from "../../../shared/paths.ts";

const keys = ["PI_ARTIFACTS_DIR", "PI_ARTIFACTS_STATE", "PI_ARTIFACTS_RUNTIME", "PI_ARTIFACTS_DB"] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterEach(() => { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
it("separates artifact files and protected state per project", () => {
 for (const key of keys) delete process.env[key];
 const a = join(process.cwd(), "project-a"), b = join(process.cwd(), "project-b");
 expect(artifactsDir(a)).toBe(join(a, ".pi", "_artifacts"));
 expect(stateDir(a)).toBe(join(a, ".pi", "_artifacts-state"));
 expect(daemonStatePath(a)).not.toBe(daemonStatePath(b));
 expect(memoryDbPath(a)).not.toBe(memoryDbPath(b));
});
it("honors explicit root, state, runtime and database overrides", () => {
 const cwd = process.cwd();
 process.env.PI_ARTIFACTS_DIR = "custom";
 delete process.env.PI_ARTIFACTS_STATE; delete process.env.PI_ARTIFACTS_RUNTIME; delete process.env.PI_ARTIFACTS_DB;
 expect(artifactsDir(cwd)).toBe(join(cwd,"custom"));
 expect(stateDir(cwd)).toBe(join(cwd,"custom/.state"));
 expect(runtimeDir(cwd)).toBe(join(cwd,"custom/.runtime"));
 process.env.PI_ARTIFACTS_STATE = "state"; process.env.PI_ARTIFACTS_RUNTIME = "runtime"; process.env.PI_ARTIFACTS_DB = "db.sqlite";
 expect(stateDir(cwd)).toBe(join(cwd,"state"));
 expect(runtimeDir(cwd)).toBe(join(cwd,"runtime"));
 expect(memoryDbPath(cwd)).toBe(join(cwd,"db.sqlite"));
});
