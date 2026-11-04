import { spawn } from "node:child_process";
import { join } from "node:path";
import { nodeBinary, nodeTsFlags } from "./node.ts";
import { VIEWER_DIR } from "./paths.ts";

/**
 * Export an artifact to one self-contained HTML file by running the viewer's exporter
 * (`apps/viewer/scripts/export.ts`) in a child process, so Vite's build pipeline never
 * loads into pi or into the dev server.
 */
export function exportArtifactHtml(
	id: string,
	outFile: string,
	signal?: AbortSignal,
): Promise<{ file: string; bytes: number }> {
	return new Promise((resolve, reject) => {
		const child = spawn(nodeBinary(), [...nodeTsFlags(), join(VIEWER_DIR, "scripts/export.ts"), id, outFile], {
			cwd: VIEWER_DIR,
			// Production React even when called from the dev server (which sets NODE_ENV=development).
			env: { ...process.env, NODE_ENV: "production", FORCE_COLOR: "0" },
			stdio: ["ignore", "pipe", "pipe"],
			signal,
		});
		let out = "";
		let err = "";
		child.stdout.on("data", (d: Buffer) => (out += d));
		child.stderr.on("data", (d: Buffer) => (err += d));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				try {
					return resolve(JSON.parse(out.trim().split("\n").pop() ?? "") as { file: string; bytes: number });
				} catch {}
			}
			reject(new Error(err.trim() || out.trim() || `Exporter exited with code ${code}`));
		});
	});
}
