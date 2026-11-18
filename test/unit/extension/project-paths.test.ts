import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { artifactsDir, daemonStatePath, memoryDbPath, runtimeDir, stateDir } from "../../../shared/paths.ts";

const keys = ["PI_ARTIFACTS_DIR", "PI_ARTIFACTS_STATE", "PI_ARTIFACTS_RUNTIME", "PI_ARTIFACTS_DB"] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterEach(() => { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
it("separates artifact files and protected state per project", () => {
 for (const key of keys) delete process.env[key];
 const base = mkdtempSync(join(tmpdir(), "pi-project-paths-"));
 try {
  const a = join(base, "project-a"), b = join(base, "project-b");
  mkdirSync(join(a, ".git"), { recursive: true }); mkdirSync(join(b, ".git"), { recursive: true });
  expect(artifactsDir(a)).toBe(join(a, ".pi", "_artifacts"));
  expect(stateDir(a)).toBe(join(a, ".pi", "_artifacts-state"));
  expect(daemonStatePath(a)).not.toBe(daemonStatePath(b));
  expect(memoryDbPath(a)).not.toBe(memoryDbPath(b));
 } finally { rmSync(base, { recursive: true, force: true }); }
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

it("uses the nearest Git root, including worktrees and nested repositories", () => {
 const base = mkdtempSync(join(tmpdir(), "pi-path-roots-"));
 try {
  for (const key of keys) delete process.env[key];
  const root=join(base,"repo"), sub=join(root,"src","feature"), inner=join(sub,"inner"), worktree=join(base,"worktree");
  mkdirSync(inner,{recursive:true}); mkdirSync(join(root,".git")); mkdirSync(join(worktree,"src"),{recursive:true});
  writeFileSync(join(worktree,".git"),"gitdir: /somewhere\n");
  expect(artifactsDir(sub)).toBe(join(root,".pi/_artifacts"));
  expect(stateDir(sub)).toBe(stateDir(root));
  expect(artifactsDir(join(worktree,"src"))).toBe(join(worktree,".pi/_artifacts"));
  mkdirSync(join(inner,".git"));
  expect(artifactsDir(inner)).toBe(join(inner,".pi/_artifacts"));
  process.env.PI_ARTIFACTS_DIR="relative-override";
  expect(artifactsDir(sub)).toBe(join(sub,"relative-override"));
 } finally {rmSync(base,{recursive:true,force:true});}
});

it("uses the working directory when no project marker exists", () => {
 for (const key of keys) delete process.env[key];
 const base=mkdtempSync(join(tmpdir(),"pi-no-project-"));
 try { expect(artifactsDir(base)).toBe(join(base,".pi/_artifacts")); }
 finally {rmSync(base,{recursive:true,force:true});}
});
