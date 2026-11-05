import type { SessionRegistration } from "../../shared/protocol.ts";

/** A session is dropped when it has not sent a heartbeat for this long. */
export const SESSION_TTL_MS = 90_000;

/** pi sessions connected to the daemon, each with its MCP bridge. */
export class SessionRegistry {
	private sessions = new Map<string, { reg: SessionRegistration; lastSeen: number }>();

	private readonly now: () => number;

	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	/** Register or heartbeat. */
	upsert(reg: SessionRegistration): void {
		this.sessions.set(reg.sessionId, { reg, lastSeen: this.now() });
	}

	remove(sessionId: string): void {
		this.sessions.delete(sessionId);
	}

	private live() {
		const cutoff = this.now() - SESSION_TTL_MS;
		for (const [id, s] of this.sessions) if (s.lastSeen < cutoff) this.sessions.delete(id);
		return [...this.sessions.values()].sort((a, b) => b.lastSeen - a.lastSeen);
	}

	get size(): number {
		return this.live().length;
	}

	/** The preferred session if it is live, else the most recently active one. */
	pick(preferred?: string): SessionRegistration | undefined {
		const live = this.live();
		return (live.find((s) => s.reg.sessionId === preferred) ?? live[0])?.reg;
	}
}
