import type { SessionRegistration } from "../../shared/protocol.ts";

/** A session is dropped when it has not sent a heartbeat for this long. */
export const SESSION_TTL_MS = 90_000;

/** pi sessions connected to the daemon, each with its MCP bridge. */
export class SessionRegistry {
	private sessions = new Map<string, { reg: SessionRegistration; lastSeen: number; joined: number }>();
	private readonly now: () => number;

	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	/** Register or heartbeat. */
	upsert(reg: SessionRegistration): void {
		const prev = this.sessions.get(reg.sessionId);
		this.sessions.set(reg.sessionId, { reg, lastSeen: this.now(), joined: prev?.joined ?? this.now() });
	}

	remove(sessionId: string): void {
		this.sessions.delete(sessionId);
	}

	private live() {
		const cutoff = this.now() - SESSION_TTL_MS;
		for (const [id, s] of this.sessions) if (s.lastSeen < cutoff) this.sessions.delete(id);
		return [...this.sessions.values()];
	}

	get size(): number {
		return this.live().length;
	}

	/** Whether some live session can run tools right now. */
	get anyReady(): boolean {
		return this.live().some((s) => s.reg.ready !== false);
	}

	/**
	 * Where an MCP call should go: the preferred session (the artifact's writer) if it can
	 * run the tool, else the most recently joined session that can, else any live session
	 * (which will explain why it cannot). Heartbeats do not change the order.
	 */
	pick(preferred?: string, tool?: string): SessionRegistration | undefined {
		const live = this.live().sort((a, b) => b.joined - a.joined);
		const able = (s: (typeof live)[number]) => s.reg.ready !== false && (!tool || !s.reg.tools || s.reg.tools.includes(tool));
		return (
			live.find((s) => s.reg.sessionId === preferred && able(s)) ??
			live.find(able) ??
			live.find((s) => s.reg.sessionId === preferred) ??
			live[0]
		)?.reg;
	}
}
