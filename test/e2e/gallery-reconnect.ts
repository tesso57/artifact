import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { DaemonClient } from "../../extension/daemon-client.ts";

const keys=["PI_ARTIFACTS_DIR","PI_ARTIFACTS_STATE","PI_ARTIFACTS_DB","PI_ARTIFACTS_RUNTIME","PI_ARTIFACTS_TEMPLATES","PI_ARTIFACTS_DESIGN"] as const;
const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));for(const key of keys) delete process.env[key];
const dir=mkdtempSync(join(tmpdir(),"pi-gallery-reconnect-"));
const client=new DaemonClient(); client.setProject(dir);
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM}:{})});
try {
 const browserContext=await browser.newContext();
 await browserContext.addInitScript(() => {const original=window.WebSocket; const sockets: WebSocket[]=[]; (window as any).__testSockets=sockets; window.WebSocket=new Proxy(original,{construct(target,args,newTarget){const socket=Reflect.construct(target,args,newTarget) as WebSocket;sockets.push(socket);return socket;}});});
 const page=await browserContext.newPage();
 await page.goto(await client.link("/"));
 await page.getByText("No artifacts yet").waitFor();
 await page.waitForFunction(() => (window as any).__testSockets?.some((socket: WebSocket) => socket.readyState === 1), undefined, {timeout:10000});
 const search=page.getByRole("textbox", {name:"Search artifacts"});
 for (let i=0;i<20;i++) {
  await search.fill(i % 2 ? "no-match" : "no-result");
  if (await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((node) => node.textContent === "0 artifacts found"), undefined, {timeout:500}).then(() => true, () => false)) break;
  if (i === 19) throw new Error("Gallery search did not hydrate");
 }
 await search.clear();
 await client.api("/artifacts/write",{id:"first",title:"First item",code:"export default function Demo(){return <p>one</p>}",cwd:dir});
 await page.getByText("First item",{exact:true}).waitFor({timeout:10000});
 console.log("gallery updates after normal creation: OK");
 await browserContext.setOffline(true);
 await page.evaluate(()=>{for(const socket of (window as any).__testSockets) socket.close();});
 await client.api("/artifacts/write",{id:"second",title:"Second item",code:"export default function Demo(){return <p>two</p>}",cwd:dir});
 await browserContext.setOffline(false);
 await page.getByText("Second item",{exact:true}).waitFor({timeout:25000});
 assert.equal(await page.getByText("First item",{exact:true}).count(),1);
 console.log("gallery catches up after connection interruption: OK");
} finally {
 await browser.close();
 await client.api("/shutdown",{}, {start:false}).catch(()=>{});
 for(const key of keys) {if(saved[key]===undefined) delete process.env[key];else process.env[key]=saved[key];}
 try{rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}catch{}
}
