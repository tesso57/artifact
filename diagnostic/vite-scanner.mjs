import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
const root=mkdtempSync(join(tmpdir(),'tailwind dynamic '));
const short=join(root,'templates');
mkdirSync(short);
const long=realpathSync.native(short);
const css=(base)=>`@import "tailwindcss";\n@source ${JSON.stringify(base.replaceAll('\\','/')+'/*/template.tsx')};\n`;
writeFileSync(resolve('diagnostic/short.css'),css(short));
writeFileSync(resolve('diagnostic/long.css'),css(long));
const server=await createServer({configFile:false,root:process.cwd(),logLevel:'error',plugins:[tailwindcss()],server:{host:'127.0.0.1',port:0}});
try {
 await server.listen();
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 const read=async(name)=>(await fetch(`${origin}/diagnostic/${name}.css`)).text();
 for(const name of ['short','long']) console.log(JSON.stringify({phase:'before',name,found:(await read(name)).includes('31px')}));
 mkdirSync(join(short,'new-template'));
 writeFileSync(join(short,'new-template','template.tsx'),'<div className="text-[31px]"/>');
 for(let i=0;i<15;i++) {await new Promise(r=>setTimeout(r,1000)); const shortFound=(await read('short')).includes('31px');const longFound=(await read('long')).includes('31px');if(shortFound&&longFound) break;}
 for(const name of ['short','long']) console.log(JSON.stringify({phase:'after',name,found:(await read(name)).includes('31px')}));
 console.log(JSON.stringify({shortDistinct:short.toLowerCase()!==long.toLowerCase()}));
} finally {await server.close()}
