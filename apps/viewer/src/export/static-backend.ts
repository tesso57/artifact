/**
 * SDK backend of exported HTML files: no server. Memory starts from the snapshot and
 * persists in localStorage; MCP calls replay the results captured at export time.
 */
import { mcpCacheKey } from "@pi-artifacts/core/bridge";
import type { Backend, MemoryRow } from "@/sdk/backend";
import type { ArtifactSnapshot } from "./snapshot";

const snapshot = (): ArtifactSnapshot =>
	window.__PI_ARTIFACT__ ?? { artifact: { id: "artifact", title: "Artifact" }, exportedAt: 0, memory: [], mcp: {} };

const storageKey = () => `pi-artifact:${snapshot().artifact.id}:${snapshot().exportedAt}`;

type Rows = Record<string, { value: unknown; updatedAt: number }>;

function load(): Rows {
	const rows: Rows = {};
	for (const m of snapshot().memory) rows[`${m.scope}\u0000${m.key}`] = { value: m.value, updatedAt: m.updatedAt };
	try {
		const saved = localStorage.getItem(storageKey());
		if (saved) Object.assign(rows, JSON.parse(saved) as Rows);
	} catch {}
	return rows;
}

let rows: Rows | undefined;
const db = () => (rows ??= load());

function save() {
	try {
		localStorage.setItem(storageKey(), JSON.stringify(db()));
	} catch {}
}

export const backend: Backend = {
	mode: "static",
	async memoryGet(scope, key) {
		return db()[`${scope}\u0000${key}`]?.value;
	},
	async memorySet(scope, key, value) {
		if (value === undefined) delete db()[`${scope}\u0000${key}`];
		else db()[`${scope}\u0000${key}`] = { value, updatedAt: Date.now() };
		save();
	},
	async memoryDelete(scope, key) {
		const k = `${scope}\u0000${key}`;
		const had = k in db();
		delete db()[k];
		save();
		return had;
	},
	async memoryList(scope, prefix = "") {
		const out: MemoryRow[] = [];
		for (const [k, v] of Object.entries(db())) {
			const [s, key] = k.split("\u0000");
			if (s === scope && key.startsWith(prefix)) out.push({ key, ...v });
		}
		return out.sort((a, b) => (a.key < b.key ? -1 : 1));
	},
	async mcpStatus() {
		return { connected: false, ready: false };
	},
	async mcpTools() {
		return [];
	},
	async mcpCall(name, args, artifactId) {
		const hit = snapshot().mcp[mcpCacheKey(artifactId ?? snapshot().artifact.id, name, args)];
		if (hit) return hit;
		return {
			isError: true,
			text: `${name} is not available in this exported file (no result was captured for these arguments)`,
			content: [],
		};
	},
};
