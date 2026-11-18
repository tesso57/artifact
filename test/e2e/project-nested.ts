import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { DaemonClient } from "../../extension/daemon-client.ts";
import { startPi, openLink } from "./pi.ts";

const keys = ["PI_ARTIFACTS_DIR","PI_ARTIFACTS_STATE","PI_ARTIFACTS_DB","PI_ARTIFACTS_RUNTIME","PI_ARTIFACTS_TEMPLATES","PI_ARTIFACTS_DESIGN"] as const;
const saved = Object.fromEntries(keys.map((key)=>[key,process.env[key]]));
for (const key of keys) delete process.env[key];
const base=mkdtempSync(join(tmpdir(),"pi-nested-project-"));
const root=join(base,"repository"), sub=join(root,"src","feature"), other=join(base,"another");
mkdirSync(sub,{recursive:true});mkdirSync(other);
execFileSync("git",["init","-q",root]);execFileSync("git",["init","-q",other]);
const sessions=[] as Awaited<ReturnType<typeof startPi>>[];
try {
 for (const [index,cwd] of [root,sub,other].entries()) {
  const pi=await startPi(cwd);sessions.push(pi);
  if(index===0 || index===2) {
   pi.respond([fauxAssistantMessage(fauxToolCall("artifact_write",{id:"same-id",title:index===0?"Root":"Other",code:`export default function Demo(){return <p>${index}</p>}`})),fauxAssistantMessage("done")]);
   await pi.prompt("Create the artifact");
   assert.equal(pi.lastResult("artifact_write").isError,false,pi.lastResult("artifact_write").text);
  } else {
   pi.respond([fauxAssistantMessage(fauxToolCall("artifact_link",{id:"same-id"})),fauxAssistantMessage("done")]);
   await pi.prompt("Open the artifact created from the repository root");
   const result=pi.lastResult("artifact_link");assert.equal(result.isError,false,result.text);
   assert.equal((await fetch(openLink(result.text),{redirect:"manual"})).status,302);
   pi.respond([fauxAssistantMessage(fauxToolCall("artifact_write",{id:"nested-id",title:"Nested",code:"export default function Demo(){return <p>nested</p>}"})),fauxAssistantMessage("done")]);
   await pi.prompt("Create another artifact from this working directory");
   assert.equal(pi.lastResult("artifact_write").isError,false,pi.lastResult("artifact_write").text);
  }
 }
 const meta=JSON.parse(readFileSync(join(root,".pi/_artifacts/nested-id/meta.json"),"utf8"));
 assert.equal(meta.cwd,sub);
 const rootClient=new DaemonClient();rootClient.setProject(root);
 const subClient=new DaemonClient();subClient.setProject(sub);
 assert.equal((await rootClient.ensure()).url,(await subClient.ensure()).url);
 const otherClient=new DaemonClient();otherClient.setProject(other);
 assert.notEqual((await rootClient.ensure()).url,(await otherClient.ensure()).url);
 assert.equal(JSON.parse(readFileSync(join(other,".pi/_artifacts/same-id/meta.json"),"utf8")).title,"Other");
 console.log("Real Pi root and subdirectory share artifacts and viewer; actual cwd and other-repository isolation preserved: OK");
} finally {
 for (const pi of sessions) {const client=new DaemonClient();client.setProject(pi.cwd);await client.api("/shutdown",{}, {start:false}).catch(()=>{});await pi.close();}
 for (const key of keys) {if(saved[key]===undefined) delete process.env[key];else process.env[key]=saved[key];}
 try {rmSync(base,{recursive:true,force:true,maxRetries:5,retryDelay:100})} catch {}
}
