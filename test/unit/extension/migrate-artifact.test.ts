import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { Memory } from "../../../viewer/server/memory.ts";

it("copies only the verified artifact and its referenced memory without changing the legacy source", () => {
 const base=mkdtempSync(join(tmpdir(),"artifact-migrate-"));
 const project=join(base,"project"), other=join(base,"other"), legacy=join(base,"legacy");
 const source=join(legacy,"item");
 mkdirSync(project); mkdirSync(other); mkdirSync(source,{recursive:true});
 writeFileSync(join(source,"meta.json"), JSON.stringify({id:"item",cwd:project,title:"test"}));
 writeFileSync(join(source,"index.tsx"),"export default 1;");
 const dbPath=join(legacy,".state","memory.sqlite");
 const memory=new Memory(dbPath);
 memory.set("item","review",{text:"keep"}); memory.set("other","review",{text:"private"});
 memory.set("shared","used","yes"); memory.set("shared","unrelated","no"); memory.noteSharedRead("item","used");
 memory.close();
 const env={...process.env}; for(const key of ["PI_ARTIFACTS_DIR","PI_ARTIFACTS_STATE","PI_ARTIFACTS_DB","PI_ARTIFACTS_RUNTIME"]) delete env[key];
 const run=(dir:string,apply:boolean)=>execFileSync(process.execPath,["--no-warnings",resolve("scripts/migrate-artifact.mjs"),"item",dir,legacy,...(apply?["--apply"]:[])],{env,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
 try {
  expect(()=>run(other,true)).toThrow();
  expect(JSON.parse(run(project,false)).counts).toMatchObject({memory:1,reads:1,shared:1});
  const targetDb=join(project,".pi/_artifacts-state/memory.sqlite");
  const existing=new Memory(targetDb); existing.set("shared","used","different"); existing.close();
  expect(()=>run(project,true)).toThrow();
  expect(existsSync(join(project,".pi/_artifacts/item"))).toBe(false);
  const restore=new Memory(targetDb); expect(restore.get("shared","used")).toBe("different"); restore.set("shared","used","yes"); restore.close();
  run(project,true);
  expect(readFileSync(join(project,".pi/_artifacts/item/index.tsx"),"utf8")).toBe("export default 1;");
  expect(readFileSync(join(project,".pi/_artifacts-state/.gitignore"),"utf8")).toBe("*\n");
  const migrated=new DatabaseSync(join(project,".pi/_artifacts-state/memory.sqlite"),{readOnly:true});
  try {
   const rows=migrated.prepare("select scope,key from memory order by scope,key").all();
   expect(rows).toEqual([{scope:"item",key:"review"},{scope:"shared",key:"used"}]);
  } finally { migrated.close(); }
  expect(readFileSync(join(source,"index.tsx"),"utf8")).toBe("export default 1;");
  expect(()=>run(project,true)).toThrow();
 } finally {rmSync(base,{recursive:true,force:true});}
});
