import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { DaemonClient } from "../../extension/daemon-client.ts";
import { startPi, openLink } from "./pi.ts";

const keys = ["PI_ARTIFACTS_DIR","PI_ARTIFACTS_STATE","PI_ARTIFACTS_DB","PI_ARTIFACTS_RUNTIME","PI_ARTIFACTS_TEMPLATES","PI_ARTIFACTS_DESIGN"] as const;
const saved = Object.fromEntries(keys.map((key)=>[key,process.env[key]]));
for (const key of keys) delete process.env[key];
const sessions = [] as Awaited<ReturnType<typeof startPi>>[];
try {
 for (let i=0;i<2;i++) {
  const pi=await startPi(); sessions.push(pi);
  pi.respond([fauxAssistantMessage(fauxToolCall("artifact_write",{id:"same-id",title:`Project ${i}`,code:`export default function Demo(){return <p>Project ${i}</p>}`})),fauxAssistantMessage("done")]);
  await pi.prompt("Create the artifact");
  const result=pi.lastResult("artifact_write");
  assert.equal(result.isError,false,result.text);
  assert.ok(existsSync(join(pi.cwd,".pi","_artifacts","same-id","index.tsx")));
  const response=await fetch(openLink(result.text),{redirect:"manual"});
  assert.equal(response.status,302);
 }
 assert.notEqual(sessions[0].cwd,sessions[1].cwd);
 for (const [i,pi] of sessions.entries()) {
  const client=new DaemonClient(); client.setProject(pi.cwd);
  const entries=await client.api<{id:string;title:string}[]>("/artifacts");
  assert.deepEqual(entries.map((entry)=>[entry.id,entry.title]),[["same-id",`Project ${i}`]]);
 }
 console.log("Two real Pi sessions create separate same-ID artifacts and working links: OK");
} finally {
 for (const pi of sessions) {
  const client=new DaemonClient();client.setProject(pi.cwd);
  await client.api("/shutdown",{}, {start:false}).catch(()=>{});
  await pi.close();
 }
 for (const key of keys) { if(saved[key] === undefined) delete process.env[key]; else process.env[key]=saved[key]; }
}
