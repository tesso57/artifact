import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { memoryDbPath } from "../../shared/paths.ts";
import type { McpCallResult } from "../../shared/protocol.ts";

// Loaded lazily so its ExperimentalWarning (older Node) only fires when memory is used.
const require = createRequire(import.meta.url);

interface MemoryEntry {
	scope: string;
	key: string;
	value: unknown;
	updatedAt: number;
}

/**
 * The daemon's SQLite store (the only writer):
 * - `memory`: key/value per scope (an artifact id, or "shared")
 * - `mcp_cache`: latest MCP result per artifact call, replayed by HTML exports
 * - `shared_reads`: which shared keys each artifact read, so exports embed only those
 */
export class Memory {
	private db: DatabaseSyncType;

	constructor(path = memoryDbPath()) {
		if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
		const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
		this.db = new DatabaseSync(path);
		this.db.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA busy_timeout = 5000;
			CREATE TABLE IF NOT EXISTS memory (
				scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
				PRIMARY KEY (scope, key)
			);
			CREATE TABLE IF NOT EXISTS mcp_cache (
				artifact_id TEXT NOT NULL, call TEXT NOT NULL, result TEXT NOT NULL, updated_at INTEGER NOT NULL,
				PRIMARY KEY (artifact_id, call)
			);
			CREATE TABLE IF NOT EXISTS shared_reads (
				artifact_id TEXT NOT NULL, key TEXT NOT NULL,
				PRIMARY KEY (artifact_id, key)
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
		const updatedAt = Date.now();
		if (value === undefined) {
			this.delete(scope, key);
		} else {
			this.db
				.prepare(
					`INSERT INTO memory (scope, key, value, updated_at) VALUES (?, ?, ?, ?)
					 ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
				)
				.run(scope, key, JSON.stringify(value), updatedAt);
		}
		return { scope, key, value, updatedAt };
	}

	delete(scope: string, key: string): boolean {
		return this.db.prepare("DELETE FROM memory WHERE scope = ? AND key = ?").run(scope, key).changes > 0;
	}

	list(scope: string, prefix = ""): MemoryEntry[] {
		const rows = this.db
			.prepare("SELECT key, value, updated_at FROM memory WHERE scope = ? AND substr(key, 1, ?) = ? ORDER BY key")
			.all(scope, prefix.length, prefix) as { key: string; value: string; updated_at: number }[];
		return rows.map((r) => ({ scope, key: r.key, value: JSON.parse(r.value), updatedAt: r.updated_at }));
	}

	/** Remember that `artifactId` read the shared `key` (or every shared key, for `*`). */
	noteSharedRead(artifactId: string, key: string): void {
		this.db.prepare("INSERT OR IGNORE INTO shared_reads (artifact_id, key) VALUES (?, ?)").run(artifactId, key);
	}

	sharedReads(artifactId: string): string[] {
		const rows = this.db.prepare("SELECT key FROM shared_reads WHERE artifact_id = ?").all(artifactId) as { key: string }[];
		return rows.map((r) => r.key);
	}

	cacheMcp(artifactId: string, call: string, result: McpCallResult): void {
		this.db
			.prepare(
				`INSERT INTO mcp_cache (artifact_id, call, result, updated_at) VALUES (?, ?, ?, ?)
				 ON CONFLICT(artifact_id, call) DO UPDATE SET result = excluded.result, updated_at = excluded.updated_at`,
			)
			.run(artifactId, call, JSON.stringify({ isError: false, text: result.text, data: result.data }), Date.now());
	}

	mcpCache(artifactId: string): Record<string, McpCallResult> {
		const rows = this.db.prepare("SELECT call, result FROM mcp_cache WHERE artifact_id = ?").all(artifactId) as {
			call: string;
			result: string;
		}[];
		return Object.fromEntries(rows.map((r) => [r.call, JSON.parse(r.result) as McpCallResult]));
	}

	/** Everything stored for an artifact (memory scope, MCP cache, shared reads). */
	forget(artifactId: string): void {
		this.db.prepare("DELETE FROM memory WHERE scope = ?").run(artifactId);
		this.db.prepare("DELETE FROM mcp_cache WHERE artifact_id = ?").run(artifactId);
		this.db.prepare("DELETE FROM shared_reads WHERE artifact_id = ?").run(artifactId);
	}

	close(): void {
		this.db.close();
	}
}
