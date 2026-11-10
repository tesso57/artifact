import { describe, expect, it, vi } from "vitest";
import { SESSION_TTL_MS, SessionRegistry } from "../../../viewer/server/sessions.ts";

const reg = (sessionId: string, extra: { ready?: boolean; tools?: string[] } = {}) => ({
	sessionId,
	cwd: "/",
	bridgeUrl: `http://b/${sessionId}`,
	bridgeToken: "t",
	...extra,
});

describe("SessionRegistry", () => {
	it("does not expire a live session when the wall clock jumps", () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1000);
		try {
			const registry = new SessionRegistry();
			registry.upsert(reg("a"));
			now.mockReturnValue(1000 + SESSION_TTL_MS * 2);
			expect(registry.size).toBe(1);
		} finally {
			now.mockRestore();
		}
	});
	it("prefers the requested session, else the most recently joined one; heartbeats do not reorder", () => {
		let now = 1000;
		const r = new SessionRegistry(() => now);
		r.upsert(reg("a"));
		now += 10;
		r.upsert(reg("b"));
		now += 10;
		r.upsert(reg("a")); // heartbeat
		expect(r.pick()?.sessionId).toBe("b");
		expect(r.pick("a")?.sessionId).toBe("a");
		expect(r.pick("gone")?.sessionId).toBe("b");
	});

	it("orders sessions by registration even when timestamps are equal", () => {
		const r = new SessionRegistry(() => 1000);
		r.upsert(reg("a"));
		r.upsert(reg("b"));
		r.upsert(reg("a"));
		expect(r.pick()?.sessionId).toBe("b");
	});

	it("treats a heartbeat after expiration as a new join", () => {
		let now = 0;
		const r = new SessionRegistry(() => now);
		r.upsert(reg("a"));
		now = SESSION_TTL_MS - 1;
		r.upsert(reg("b"));
		now = SESSION_TTL_MS + 1;
		r.upsert(reg("a"));
		expect(r.pick()?.sessionId).toBe("a");
	});

	it("skips sessions that cannot run the tool", () => {
		const r = new SessionRegistry(() => 1);
		r.upsert(reg("writer", { ready: false, tools: ["mcp__x__y"] }));
		r.upsert(reg("other", { ready: true, tools: ["mcp__z__w"] }));
		r.upsert(reg("able", { ready: true, tools: ["mcp__x__y"] }));
		expect(r.pick("writer", "mcp__x__y")?.sessionId).toBe("able");
		expect(r.pick("writer", "mcp__q__q")?.sessionId).toBe("writer"); // nobody can: ask the writer, it explains
	});

	it("expires sessions without heartbeats", () => {
		let now = 0;
		const r = new SessionRegistry(() => now);
		r.upsert(reg("a"));
		now += SESSION_TTL_MS + 1;
		expect(r.size).toBe(0);
		expect(r.pick()).toBeUndefined();
	});
});
