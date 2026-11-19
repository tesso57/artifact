import { performance } from "node:perf_hooks";
import type { SessionRegistration } from "../../shared/protocol.ts";

export const SESSION_TTL_MS = 90_000;

export class SessionRegistry {
	private sessions = new Map<string, { reg: SessionRegistration; lastSeen: number; joined: number }>();
	private readonly now: () => number;
	private joinSequence = 0;

	constructor(now: () => number = () => performance.now()) {
		this.now = now;
	}

	upsert(reg: SessionRegistration): void {
		const now = this.now();
		const prev = this.sessions.get(reg.sessionId);
		const joined = prev && prev.lastSeen >= now - SESSION_TTL_MS ? prev.joined : ++this.joinSequence;
		this.sessions.set(reg.sessionId, { reg, lastSeen: now, joined });
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

	get anyReady(): boolean {
		return this.live().some((s) => s.reg.ready !== false);
	}

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
