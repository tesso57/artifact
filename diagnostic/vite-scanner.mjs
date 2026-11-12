import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
const root=mkdtempSync(join(tmpdir(),'tailwind dynamic '));
const short=join(root,'templates');
mkdirSync(short);
const long=realpathSync.native(short);
symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'junction');
const css=(base)=>`@import "tailwindcss";\n@source ${JSON.stringify(base.replaceAll('\\','/')+'/*/template.tsx')};\n`;
writeFileSync(join(root,'short.css'),css(short));
writeFileSync(join(root,'long.css'),css(long));
const server=await createServer({configFile:false,root,logLevel:'error',plugins:[tailwindcss()],server:{host:'127.0.0.1',port:0}});
try {
 await server.listen();
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 const read=async(name)=>(await fetch(`${origin}/${name}.css`)).text();
 for(const name of ['short','long']) console.log(JSON.stringify({phase:'before',name,found:(await read(name)).includes('787' + 'px')}));
 const graph = server.environments.client.moduleGraph;
 const shortFile = join(root, 'short.css');
 const longFile = realpathSync.native(shortFile);
 console.log(JSON.stringify({phase:'module-paths',short:graph.getModulesByFile(shortFile)?.size ?? 0,long:graph.getModulesByFile(longFile)?.size ?? 0,distinct:shortFile.toLowerCase()!==longFile.toLowerCase()}));
 mkdirSync(join(short,'new-template'));
 writeFileSync(join(short,'new-template','template.tsx'),'<div className="text-[' + '787' + 'px]"/>');
 for (const name of ['short','long']) { const file = join(root, name+'.css'); for (const module of graph.getModulesByFile(file) ?? []) graph.invalidateModule(module); await server.environments.client.transformRequest('/'+name+'.css?direct'); }
 for(let i=0;i<5;i++) {await new Promise(r=>setTimeout(r,1000)); const shortFound=(await read('short')).includes('787' + 'px');const longFound=(await read('long')).includes('787' + 'px');if(shortFound&&longFound) break;}
 for(const name of ['short','long']) console.log(JSON.stringify({phase:'after',name,found:(await read(name)).includes('787' + 'px')}));
 console.log(JSON.stringify({shortDistinct:short.toLowerCase()!==long.toLowerCase()}));
} finally {await server.close()}
