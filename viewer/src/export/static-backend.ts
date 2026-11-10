/**
 * SDK backend of exported HTML files: no server. Memory starts from the snapshot and
 * persists in localStorage; MCP calls replay the results captured at export time.
 */
import { assertMemoryKey, assertMemoryScope } from "../../../shared/ids.ts";
import { mcpCallKey, memoryMatches } from "../../../shared/protocol.ts";
import { notifyMemoryChanged } from "../sdk/memory-sync";
import type { Backend, MemoryRow } from "@/sdk/backend";
import type { ArtifactSnapshot } from "./snapshot";

const snapshot = (): ArtifactSnapshot =>
	window.__PI_ARTIFACT__ ?? { artifact: { id: "artifact", title: "Artifact" }, exportedAt: 0, memory: [], mcp: {} };

const storageKey = () => `pi-artifact:${snapshot().artifact.id}:${snapshot().snapshotId ?? snapshot().exportedAt}`;

type Rows = Record<string, { value: unknown; updatedAt: number }>;

function load(): Rows {
	const rows: Rows = {};
	for (const m of snapshot().memory) rows[`${m.scope}\u0000${m.key}`] = { value: m.value, updatedAt: m.updatedAt };
	try {
		const saved = localStorage.getItem(storageKey());
		if (saved !== null) {
			const parsed: unknown = JSON.parse(saved);
			// Saved state is a complete copy, including deletions from the snapshot.
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((row) =>
				!row || typeof row !== "object" || Array.isArray(row) || !Object.hasOwn(row, "value") ||
				typeof (row as { updatedAt?: unknown }).updatedAt !== "number" || !Number.isFinite((row as { updatedAt: number }).updatedAt),
			)) throw new Error("Invalid saved memory format");
			return parsed as Rows;
		}
	} catch (error) {
		throw new Error("Could not read artifact memory from browser storage", { cause: error });
	}
	return rows;
}

let rows: Rows | undefined;
const db = () => (rows ??= load());

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
	window.addEventListener("storage", (event) => {
		if (event.key !== storageKey() && event.key !== null) return;
		const scopes = new Set(snapshot().memory.map((entry) => entry.scope));
		const collect = (value: unknown) => {
			if (!value || typeof value !== "object" || Array.isArray(value)) return;
			for (const key of Object.keys(value)) {
				const separator = key.indexOf("\u0000");
				if (separator > 0) scopes.add(key.slice(0, separator));
			}
		};
		collect(rows);
		for (const value of [event.oldValue, event.newValue]) {
			try { if (value) collect(JSON.parse(value)); } catch {}
		}
		rows = undefined;
		for (const scope of scopes) notifyMemoryChanged(scope);
	});
}

function save(next: Rows) {
	try {
		const json = JSON.stringify(next);
		const copy = JSON.parse(json) as Rows;
		localStorage.setItem(storageKey(), json);
		rows = copy;
	} catch (error) {
		throw new Error("Could not save artifact memory to browser storage", { cause: error });
	}
}

function copyValue(value: unknown): unknown {
	return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function withIndexedDbLock<T>(factory: IDBFactory, run: () => T): Promise<T> {
	return new Promise((resolve, reject) => {
		let database: IDBDatabase | undefined;
		let transaction: IDBTransaction | undefined;
		let settled = false;
		let result: T;
		let operationError: unknown;
		let operationFinished = false;
		const finish = (error?: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error !== undefined) {
				try { transaction?.abort(); } catch {}
				database?.close();
				reject(error);
			} else {
				database?.close();
				resolve(result);
			}
		};
		const timer = setTimeout(() => finish(new Error("Could not coordinate offline memory access in time; the write may have completed")), 10_000);
		let request: IDBOpenDBRequest;
		try { request = factory.open(`pi-artifacts-memory-coordination-v2:${storageKey()}`, 1); }
		catch (error) { finish(error); return; }
		request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("locks")) request.result.createObjectStore("locks"); };
		request.onerror = () => finish(request.error ?? new Error("Could not open offline memory coordination"));
		request.onblocked = () => finish(new Error("Offline memory coordination is blocked"));
		request.onsuccess = () => {
			if (settled) { request.result.close(); return; }
			database = request.result;
			try {
				transaction = database.transaction("locks", "readwrite");
				transaction.oncomplete = () => finish();
				transaction.onabort = () => {
					const error = operationError ?? transaction?.error ?? new Error("Offline memory coordination failed");
					finish(operationFinished ? new Error("Offline memory write may have completed, but coordination failed", { cause: error }) : error);
				};
				const read = transaction.objectStore("locks").get("lock");
				read.onsuccess = () => {
					if (settled) return;
					try { result = run(); operationFinished = true; }
					catch (error) { operationError = error; transaction?.abort(); }
				};
			} catch (error) { finish(error); }
		};
	});
}

async function withStorageLock<T>(run: () => T): Promise<T> {
	const database = typeof window === "undefined" ? undefined : window.indexedDB;
	if (!database) throw new Error("Cannot coordinate offline memory writes: IndexedDB is required");
	return withIndexedDbLock(database, run);
}

function setRow(rows: Rows, scope: string, key: string, value: unknown) {
	if (value === undefined) delete rows[`${scope}\u0000${key}`];
	else {
		const json = JSON.stringify(value);
		if (json === undefined) throw new Error("Memory values must be JSON serializable");
		rows[`${scope}\u0000${key}`] = { value: JSON.parse(json), updatedAt: Date.now() };
	}
}

export const backend: Backend = {
	mode: "static",
	async memoryGet(scope, key) {
		assertMemoryScope(scope);
		assertMemoryKey(key);
		return copyValue(db()[`${scope}\u0000${key}`]?.value);
	},
	async memorySet(scope, key, value) {
		assertMemoryScope(scope);
		assertMemoryKey(key, value !== undefined);
		await withStorageLock(() => { const next = load(); setRow(next, scope, key, value); save(next); });
	},
	async memoryCompareSet(scope, key, expected, value) {
		assertMemoryScope(scope);
		assertMemoryKey(key, value !== undefined);
		return withStorageLock(() => {
			const next = load();
			if (!memoryMatches(next[`${scope}\u0000${key}`]?.value, expected)) { rows = next; return false; }
			setRow(next, scope, key, value);
			save(next);
			return true;
		});
	},
	async memoryDelete(scope, key) {
		assertMemoryScope(scope);
		assertMemoryKey(key);
		return withStorageLock(() => {
			const k = `${scope}\u0000${key}`;
			const next = load();
			const had = Object.hasOwn(next, k);
			if (!had) { rows = next; return false; }
			delete next[k];
			save(next);
			return true;
		});
	},
	async memoryList(scope, prefix = "") {
		assertMemoryScope(scope);
		const out: { row: MemoryRow; bytes: Uint8Array }[] = [];
		const scopePrefix = `${scope}\u0000`;
		const encoder = new TextEncoder();
		const prefixBytes = encoder.encode(prefix);
		for (const [k, v] of Object.entries(db())) {
			if (!k.startsWith(scopePrefix)) continue;
			const key = k.slice(scopePrefix.length);
			const bytes = encoder.encode(key);
			if (prefixBytes.every((byte, i) => bytes[i] === byte)) out.push({ row: { key, value: copyValue(v.value), updatedAt: v.updatedAt }, bytes });
		}
		// SQLite orders TEXT keys by their UTF-8 bytes, which differs from JS string
		// comparison for supplementary characters such as emoji.
		return out.sort((a, b) => {
			const length = Math.min(a.bytes.length, b.bytes.length);
			for (let i = 0; i < length; i++) if (a.bytes[i] !== b.bytes[i]) return a.bytes[i] - b.bytes[i];
			return a.bytes.length - b.bytes.length;
		}).map(({ row }) => row);
	},
	async mcpStatus() {
		return { connected: false };
	},
	async mcpTools() {
		return [];
	},
	async mcpCall(name, args) {
		const hit = snapshot().mcp[mcpCallKey(name, args)];
		if (hit) return copyValue(hit) as typeof hit;
		return {
			isError: true,
			text: `${name} is not available in this exported file (no result was captured for these arguments)`,
		};
	},
};
