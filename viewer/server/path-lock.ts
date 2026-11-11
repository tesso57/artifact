import { resolve } from "node:path";

const pending = new Map<string, Promise<void>>();

/** Serialize operations on one path within the daemon. */
export async function withPathLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
	const key = resolve(path);
	const previous = pending.get(key) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => { release = resolve; });
	pending.set(key, current);
	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (pending.get(key) === current) pending.delete(key);
	}
}
