/**
 * Export an artifact as one self-contained HTML file.
 *   node apps/viewer/scripts/export.ts <id> [out.html]
 * Prints a JSON line { file, bytes } on success.
 */
import { resolve } from "node:path";
import { exportArtifact } from "../src/export/build.ts";

const [id, out] = process.argv.slice(2);
if (!id) {
	console.error("usage: export.ts <artifact-id> [out.html]");
	process.exit(2);
}
try {
	const { file, bytes } = await exportArtifact(id, resolve(out ?? `${id}.html`));
	console.log(JSON.stringify({ file, bytes }));
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
