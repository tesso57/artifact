import { bundleArtifact } from "./export.ts";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { entry, sources, aliasRoots } = JSON.parse(input) as { entry: string; sources: string[]; aliasRoots?: string[] };
const result = await bundleArtifact(entry, sources, aliasRoots);
process.stdout.write(JSON.stringify(result));
