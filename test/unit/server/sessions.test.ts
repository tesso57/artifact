import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS, SessionRegistry } from "../../../viewer/server/sessions.ts";

const reg = (sessionId: string) => ({ sessionId, cwd: "/", bridgeUrl: `http://b/${sessionId}`, bridgeToken: "t" });

describe("SessionRegistry", () => {
	it("prefers the requested session, else the most recently active one, and expires silent ones", () => {
		let now = 1000;
		const r = new SessionRegistry(() => now);
		r.upsert(reg("a"));
		now += 10;
		r.upsert(reg("b"));
		expect(r.pick()?.sessionId).toBe("b");
		expect(r.pick("a")?.sessionId).toBe("a");
		expect(r.pick("gone")?.sessionId).toBe("b");
		now += SESSION_TTL_MS - 5; // a expired, b still alive
		expect(r.size).toBe(1);
		expect(r.pick("a")?.sessionId).toBe("b");
		r.remove("b");
		expect(r.pick()).toBeUndefined();
	});
});
