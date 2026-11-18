import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../../extension/daemon-client.ts";
import { chromium } from "playwright";

const envKeys = ["PI_ARTIFACTS_DIR", "PI_ARTIFACTS_STATE", "PI_ARTIFACTS_RUNTIME", "PI_ARTIFACTS_DB", "PI_ARTIFACTS_TEMPLATES", "PI_ARTIFACTS_DESIGN"] as const;
const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
for (const key of envKeys) delete process.env[key];
const dir = mkdtempSync(join(tmpdir(), "pi-project-scope-"));
const projects = [join(dir,"one"), join(dir,"two")];
projects.forEach((p) => mkdirSync(p));
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}), headless: true });
const clients = projects.map((project) => { const client = new DaemonClient(); client.setProject(project); return client; });
try {
 for (const [i, client] of clients.entries()) {
  const response = await client.api<{ path: string; compileError?: string }>("/artifacts/write", {id:"same-id", title:`Project ${i}`, code:`export default function Demo(){return <p>Project ${i}</p>}`, cwd:projects[i]});
  assert.equal(response.path, join(projects[i], ".pi", "_artifacts", "same-id", "index.tsx"));
  assert.equal(response.compileError, undefined);
  await client.api("/memory", {action:"set",scope:"same-id",key:"review",value:`review ${i}`});
 }
 assert.notEqual(clients[0].url, clients[1].url);
 for (const project of projects) assert.equal(readFileSync(join(project, ".pi", "_artifacts-state", ".gitignore"), "utf8"), "*\n");
 for (const [i, client] of clients.entries()) {
  const list = await client.api<{id:string;title:string}[]>("/artifacts");
  assert.deepEqual(list.map((x)=>[x.id,x.title]), [["same-id",`Project ${i}`]]);
  assert.equal(await client.api("/memory", {action:"get",scope:"same-id",key:"review"}), `review ${i}`);
  const link = await client.link("/a/same-id");
  const page = await browser.newPage();
  await page.goto(link);
  await page.locator("p").getByText(`Project ${i}`, {exact:true}).waitFor();
  await page.close();
  assert.match(readFileSync(join(projects[i],".pi","_artifacts","same-id","index.tsx"),"utf8"),new RegExp(`Project ${i}`));
 }
 await clients[0].api("/shutdown", {}, {start:false});
 for (let i=0;i<100 && await clients[0].running();i++) await new Promise((r)=>setTimeout(r,100));
 const fresh = new DaemonClient(); fresh.setProject(projects[0]);
 assert.equal((await fresh.api<{id:string}[]>("/artifacts"))[0]?.id,"same-id");
 assert.equal(await fresh.api("/memory", {action:"get",scope:"same-id",key:"review"}), "review 0");
 const page = await browser.newPage();
 await page.goto(await fresh.link("/a/same-id"));
 await page.locator("p").getByText("Project 0", {exact:true}).waitFor();
 await page.close();
 console.log("Project-specific create, list, login links, memory, same-ID isolation and restart: OK");
 await fresh.api("/shutdown", {}, {start:false});
} finally {
 await browser.close();
 for (const client of clients) await client.api("/shutdown", {}, {start:false}).catch(()=>{});
 for (const key of envKeys) {if (saved[key] === undefined) delete process.env[key]; else process.env[key]=saved[key];}
 // Daemons shut down asynchronously; leave the isolated directory for inspection if removal fails.
 try { rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}); } catch {}
}
