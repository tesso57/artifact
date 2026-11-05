import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS, SessionRegistry } from "../../../viewer/server/sessions.ts";

const reg = (sessionId: string, extra: { ready?: boolean; tools?: string[] } = {}) => ({
	sessionId,
	cwd: "/",
	bridgeUrl: `http://b/${sessionId}`,
	bridgeToken: "t",
	...extra,
});

describe("SessionRegistry", () => {
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
