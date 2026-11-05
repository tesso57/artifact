/**
 * Export worker: reads `{ entry, sources }` on stdin, bundles the artifact with Vite in
 * production mode and prints `{ js, css }` as JSON. Spawned by the daemon (export.ts).
 */
import { bundleArtifact } from "./export.ts";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { entry, sources } = JSON.parse(input) as { entry: string; sources: string[] };
const result = await bundleArtifact(entry, sources);
process.stdout.write(JSON.stringify(result));
