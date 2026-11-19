import type { QueryClient } from "@tanstack/react-query";

const writeChains = new Map<string, Promise<unknown>>();
const listeners = new Set<(scope: string) => void>();
const chainKey = (scope: string, key: string) => `${scope}\u0000${key}`;

export function notifyMemoryChanged(scope: string): void {
	for (const listener of listeners) listener(scope);
}

export function serializeMemoryWrite<T>(scope: string, key: string, run: () => Promise<T>): Promise<T> {
	const id = chainKey(scope, key);
	const next = (writeChains.get(id) ?? Promise.resolve()).catch(() => {}).then(run);
	writeChains.set(id, next);
	const finish = () => {
		if (writeChains.get(id) !== next) return;
		writeChains.delete(id);
		notifyMemoryChanged(scope);
	};
	void next.then(finish, finish);
	return next;
}

export function subscribeMemoryChanges(listener: (scope: string) => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

export function invalidateMemoryQueries(qc: QueryClient, scope: string): void {
	void qc.invalidateQueries({
		queryKey: ["pi-memory", scope],
		predicate: (query) => typeof query.queryKey[2] !== "string" || !writeChains.has(chainKey(scope, query.queryKey[2])),
	});
	void qc.invalidateQueries({ queryKey: ["pi-memory-list", scope] });
}
