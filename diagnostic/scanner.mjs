import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scanner } from '@tailwindcss/oxide';
const temp = mkdtempSync(join(tmpdir(), 'artifact scanner diagnostic '));
const dir = join(temp, 'long templates directory', 'sample');
mkdirSync(dir, {recursive:true});
writeFileSync(join(dir, 'template.tsx'), '<div className="text-[31px]"/>');
const base = join(temp, 'long templates directory');
const short = base;
const long = realpathSync.native(base);
for (const [name,path] of [['short',short],['long',long]]) {
 const scanner = new Scanner({sources:[{base:path,pattern:'*/template.tsx',negated:false}]});
 const candidates = scanner.scan();
 console.log(JSON.stringify({name,base:path,found:candidates.includes('text-[31px]'),files:scanner.files.length}));
}
console.log(JSON.stringify({shortDistinct:short.toLowerCase()!==long.toLowerCase()}));
