import { chmodSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { SHARED_SCOPE } from "../../shared/ids.ts";
import { memoryDbPath } from "../../shared/paths.ts";
import { memoryMatches, type McpCallResult, type MemorySnapshot } from "../../shared/protocol.ts";

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
		if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
		this.db = new DatabaseSync(path);
		if (path !== ":memory:") {
			for (const f of [path, `${path}-wal`, `${path}-shm`]) {
				try {
					chmodSync(f, 0o600);
				} catch {}
			}
		}
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
		// Older versions recorded "*" for a list read. Preserve the keys included by
		// that marker now, without silently including keys created after this upgrade.
		if (this.db.prepare("SELECT 1 FROM shared_reads WHERE key = '*' LIMIT 1").get()) {
			this.db.exec(`
				BEGIN IMMEDIATE;
				INSERT OR IGNORE INTO shared_reads (artifact_id, key)
				SELECT reads.artifact_id, memory.key FROM shared_reads AS reads
				JOIN memory ON memory.scope = 'shared' WHERE reads.key = '*';
				DELETE FROM shared_reads WHERE key = '*';
				COMMIT;
			`);
		}
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

	/** Apply an update only if the current JSON value still matches the caller's read. */
	compareAndSet(scope: string, key: string, expected: MemorySnapshot, value: unknown): boolean {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const matches = memoryMatches(this.get(scope, key), expected);
			if (matches) this.set(scope, key, value);
			this.db.exec("COMMIT");
			return matches;
		} catch (error) {
			try { this.db.exec("ROLLBACK"); }
			catch (rollbackError) { throw new AggregateError([error, rollbackError], "Could not roll back memory update"); }
			throw error;
		}
	}

	list(scope: string, prefix = ""): MemoryEntry[] {
		const rows = this.db
			.prepare("SELECT CAST(key AS BLOB) AS key, value, updated_at FROM memory WHERE scope = ? AND substr(CAST(key AS BLOB), 1, length(CAST(? AS BLOB))) = CAST(? AS BLOB) ORDER BY key")
			.all(scope, prefix, prefix) as { key: Uint8Array; value: string; updated_at: number }[];
		return rows.map((r) => ({ scope, key: Buffer.from(r.key).toString("utf8"), value: JSON.parse(r.value), updatedAt: r.updated_at }));
	}

	/** Remember that `artifactId` read the shared `key` (or every shared key, for `*`). */
	noteSharedRead(artifactId: string, key: string): void {
		this.db.prepare("INSERT OR IGNORE INTO shared_reads (artifact_id, key) VALUES (?, ?)").run(artifactId, key);
	}

	/** Shared values this artifact read, without loading unrelated values. */
	listReadShared(artifactId: string): MemoryEntry[] {
		if (this.db.prepare("SELECT 1 FROM shared_reads WHERE artifact_id = ? AND key = '*'").get(artifactId)) return this.list(SHARED_SCOPE);
		// Older Node SQLite releases truncate TEXT values at embedded NUL; BLOB reads preserve them.
		// CROSS JOIN keeps the small read set first; an ordinary JOIN may scan every shared key.
		const rows = this.db.prepare(`
			SELECT CAST(memory.key AS BLOB) AS key, memory.value, memory.updated_at
			FROM shared_reads AS reads
			CROSS JOIN memory
			WHERE reads.artifact_id = ? AND memory.scope = ? AND memory.key = reads.key
			ORDER BY reads.key
		`).all(artifactId, SHARED_SCOPE) as { key: Uint8Array; value: string; updated_at: number }[];
		return rows.map((r) => ({ scope: SHARED_SCOPE, key: Buffer.from(r.key).toString("utf8"), value: JSON.parse(r.value), updatedAt: r.updated_at }));
	}

	cacheMcp(artifactId: string, call: string, result: McpCallResult): void {
		this.db
			.prepare(
				`INSERT INTO mcp_cache (artifact_id, call, result, updated_at) VALUES (?, ?, ?, ?)
				 ON CONFLICT(artifact_id, call) DO UPDATE SET result = excluded.result, updated_at = excluded.updated_at`,
			)
			.run(artifactId, call, JSON.stringify({ isError: false, text: result.text, data: result.data }), Date.now());
	}

	clearMcp(artifactId: string, call: string): void {
		this.db.prepare("DELETE FROM mcp_cache WHERE artifact_id = ? AND call = ?").run(artifactId, call);
	}

	clearArtifactMcp(artifactId: string): void {
		this.db.prepare("DELETE FROM mcp_cache WHERE artifact_id = ?").run(artifactId);
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
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db.prepare("DELETE FROM memory WHERE scope = ?").run(artifactId);
			this.db.prepare("DELETE FROM mcp_cache WHERE artifact_id = ?").run(artifactId);
			this.db.prepare("DELETE FROM shared_reads WHERE artifact_id = ?").run(artifactId);
			this.db.exec("COMMIT");
		} catch (error) {
			try { this.db.exec("ROLLBACK"); }
			catch (rollbackError) { throw new AggregateError([error, rollbackError], "Could not roll back artifact memory cleanup"); }
			throw error;
		}
	}

	close(): void {
		this.db.close();
	}
}
