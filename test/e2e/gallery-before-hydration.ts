import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { DaemonClient } from "../../extension/daemon-client.ts";

const keys=["PI_ARTIFACTS_DIR","PI_ARTIFACTS_STATE","PI_ARTIFACTS_DB","PI_ARTIFACTS_RUNTIME","PI_ARTIFACTS_TEMPLATES","PI_ARTIFACTS_DESIGN"] as const;
const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));for(const key of keys) delete process.env[key];
const dir=mkdtempSync(join(tmpdir(),"pi-gallery-hydration-"));const client=new DaemonClient();client.setProject(dir);
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM?{executablePath:process.env.PLAYWRIGHT_CHROMIUM}:{})});
let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});
try {
 const context=await browser.newContext();
 await context.route("**/*",async route=>{if(route.request().resourceType()==="script") await gate;await route.continue();});
 const page=await context.newPage();
 await page.goto(await client.link("/"),{waitUntil:"commit"});
 await page.getByText("No artifacts yet").waitFor({timeout:10000});
 await client.api("/artifacts/write",{id:"hydration",title:"Hydration item",code:"export default function Demo(){return <p>demo</p>}",cwd:dir});
 release();
 await page.getByText("Hydration item",{exact:true}).waitFor({timeout:15000});
 console.log("gallery catches updates before client hydration: OK");
} finally {release();await browser.close();await client.api("/shutdown",{}, {start:false}).catch(()=>{});for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}try{rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}catch{}}
