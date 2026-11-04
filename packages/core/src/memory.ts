import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { createRequire } from "node:module";
import { memoryDbPath } from "./paths.ts";

// node:sqlite is loaded lazily with require so bundlers leave it alone and its
// ExperimentalWarning only fires when memory is actually used.
const require = createRequire(import.meta.url);

export interface MemoryEntry {
	scope: string;
	key: string;
	value: unknown;
	updatedAt: number;
}

/**
 * Tiny key/value memory backed by SQLite. `scope` is usually an artifact id;
 * the scope "shared" is readable and writable by every artifact.
 */
export class Memory {
	private db: DatabaseSyncType;

	constructor(path = memoryDbPath()) {
		if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
		const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
		this.db = new DatabaseSync(path);
		this.db.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA busy_timeout = 2000;
			CREATE TABLE IF NOT EXISTS memory (
				scope TEXT NOT NULL,
				key TEXT NOT NULL,
				value TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (scope, key)
			);
		`);
	}

	get<T = unknown>(scope: string, key: string): T | undefined {
		const row = this.db.prepare("SELECT value FROM memory WHERE scope = ? AND key = ?").get(scope, key) as
			| { value: string }
			| undefined;
		return row ? (JSON.parse(row.value) as T) : undefined;
	}

	set(scope: string, key: string, value: unknown): MemoryEntry {
		if (value === undefined) {
			this.delete(scope, key);
			return { scope, key, value: undefined, updatedAt: Date.now() };
		}
		const updatedAt = Date.now();
		this.db
			.prepare(
				`INSERT INTO memory (scope, key, value, updated_at) VALUES (?, ?, ?, ?)
				 ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			)
			.run(scope, key, JSON.stringify(value), updatedAt);
		return { scope, key, value, updatedAt };
	}

	delete(scope: string, key: string): boolean {
		return this.db.prepare("DELETE FROM memory WHERE scope = ? AND key = ?").run(scope, key).changes > 0;
	}

	list(scope: string, prefix = ""): MemoryEntry[] {
		const rows = this.db
			.prepare(
				"SELECT scope, key, value, updated_at FROM memory WHERE scope = ? AND substr(key, 1, ?) = ? ORDER BY key",
			)
			.all(scope, prefix.length, prefix) as { scope: string; key: string; value: string; updated_at: number }[];
		return rows.map((r) => ({ scope: r.scope, key: r.key, value: JSON.parse(r.value), updatedAt: r.updated_at }));
	}

	clear(scope: string): number {
		return Number(this.db.prepare("DELETE FROM memory WHERE scope = ?").run(scope).changes);
	}

	close(): void {
		this.db.close();
	}
}

let shared: Memory | undefined;
/** Process-wide memory instance for the default database path. */
export function getMemory(): Memory {
	shared ??= new Memory();
	return shared;
}
