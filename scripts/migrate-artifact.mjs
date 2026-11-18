#!/usr/bin/env node
// Copy a single, explicitly selected legacy artifact; never modify the legacy data.
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { artifactsDir, memoryDbPath, projectRoot, stateDir } from "../shared/paths.ts";
import { assertArtifactId } from "../shared/ids.ts";

const [id, projectArg, ...rest] = process.argv.slice(2);
const sourceArg = rest.find((arg) => !arg.startsWith("--"));
const options = rest.filter((arg) => arg.startsWith("--"));
if (!id || !projectArg || options.some((arg) => arg !== "--apply")) throw new Error("Usage: node scripts/migrate-artifact.mjs <id> <project> [legacy-root] [--apply]");
assertArtifactId(id);
const project = realpathSync(projectRoot(resolve(projectArg)));
const sourceRoot = resolve(sourceArg || join(homedir(), ".pi", "artifacts"));
const source = join(sourceRoot, id);
const meta = JSON.parse(readFileSync(join(source, "meta.json"), "utf8"));
if (meta.id !== id || !meta.cwd || realpathSync(projectRoot(meta.cwd)) !== project) throw new Error("Artifact metadata does not establish membership in the requested project");
const targetRoot = artifactsDir(project);
const stateRoot = stateDir(project);
const target = join(targetRoot, id);
const targetDb = memoryDbPath(project);
for (const dir of [join(project, ".pi"), targetRoot, stateRoot]) {
 if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error(`Refusing symbolic-link destination directory: ${dir}`);
}
if (existsSync(target)) throw new Error(`Destination already exists: ${target}`);
function inspect(path) {
 const st = lstatSync(path);
 if (st.isSymbolicLink()) throw new Error(`Symlinks are not copied: ${path}`);
 if (st.isDirectory()) for (const name of readdirSync(path)) inspect(join(path, name));
 else if (!st.isFile()) throw new Error(`Unsupported file type: ${path}`);
}
inspect(source);
const dbPath = join(sourceRoot, ".state", "memory.sqlite");
const rows = { memory: [], mcp: [], reads: [], shared: [] };
if (existsSync(dbPath)) {
 const db = new DatabaseSync(dbPath, { readOnly: true });
 try {
  db.exec("BEGIN");
  rows.memory = db.prepare("SELECT scope,key,value,updated_at FROM memory WHERE scope=?").all(id);
  rows.mcp = db.prepare("SELECT artifact_id,call,result,updated_at FROM mcp_cache WHERE artifact_id=?").all(id);
  rows.reads = db.prepare("SELECT artifact_id,key FROM shared_reads WHERE artifact_id=?").all(id);
  if (rows.reads.some((row) => row.key === "*")) throw new Error("Legacy wildcard shared reads require manual review before migration");
  for (const row of rows.reads) {
   const shared = db.prepare("SELECT scope,key,value,updated_at FROM memory WHERE scope='shared' AND key=?").get(row.key);
   if (shared) rows.shared.push(shared);
  }
  db.exec("COMMIT");
 } finally { db.close(); }
}
console.log(JSON.stringify({ id, project, source, target, stateRoot, targetDb, counts: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length])), mode: options.includes("--apply") ? "apply" : "dry-run" }));
if (options.includes("--apply")) {
 mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
 mkdirSync(dirname(targetDb), { recursive: true, mode: 0o700 });
 if (stateRoot === join(project, ".pi", "_artifacts-state")) {
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  try { writeFileSync(join(stateRoot, ".gitignore"), "*\n", { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
 }
 const stage = mkdtempSync(join(targetRoot, ".migration-"));
 let moved = false;
 const db = new DatabaseSync(targetDb);
 try { chmodSync(targetDb, 0o600); } catch {}
 try {
  db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS memory (scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(scope,key)); CREATE TABLE IF NOT EXISTS mcp_cache (artifact_id TEXT NOT NULL,call TEXT NOT NULL,result TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(artifact_id,call)); CREATE TABLE IF NOT EXISTS shared_reads (artifact_id TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(artifact_id,key)); BEGIN IMMEDIATE;");
  for (const row of [...rows.memory, ...rows.shared]) {
   const old = db.prepare("SELECT value FROM memory WHERE scope=? AND key=?").get(row.scope, row.key);
   if (old && old.value !== row.value) throw new Error(`Memory conflict for scope ${row.scope}, key ${row.key}`);
   db.prepare("INSERT OR IGNORE INTO memory (scope,key,value,updated_at) VALUES (?,?,?,?)").run(row.scope,row.key,row.value,row.updated_at);
  }
  for (const row of rows.mcp) db.prepare("INSERT INTO mcp_cache (artifact_id,call,result,updated_at) VALUES (?,?,?,?)").run(row.artifact_id,row.call,row.result,row.updated_at);
  for (const row of rows.reads) db.prepare("INSERT OR IGNORE INTO shared_reads (artifact_id,key) VALUES (?,?)").run(row.artifact_id,row.key);
  cpSync(source, join(stage, basename(target)), { recursive: true, errorOnExist: true, force: false });
  if (existsSync(target)) throw new Error(`Destination appeared during migration: ${target}`);
  renameSync(join(stage, basename(target)), target);
  moved = true;
  db.exec("COMMIT");
 } catch (error) {
  try { db.exec("ROLLBACK"); } catch {}
  if (moved) rmSync(target, { recursive: true, force: true });
  throw error;
 } finally { db.close(); rmSync(stage, { recursive: true, force: true }); }
}
