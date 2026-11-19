const observations = new Map<string, string>();

export function registerRuntimeObservation(url: string, token: string): void {
	observations.set(url, token);
}

export function runtimeObservation(moduleUrl: string, stack?: string, sourceUrl?: string): string | undefined {
	const entry = new URL(moduleUrl, location.origin);
	for (const line of stack?.split("\n") ?? []) {
		const address = /^(?:\s*at (?:.*? \()?|[^@\s]*@)(https?:\/\/\S+):\d+:\d+\)?$/.exec(line)?.[1];
		if (!address || !URL.canParse(address)) continue;
		const url = new URL(address);
		if (url.origin === entry.origin && url.pathname === entry.pathname) return observations.get(url.href);
	}
	if (sourceUrl && URL.canParse(sourceUrl, location.origin)) {
		const url = new URL(sourceUrl, location.origin);
		if (url.origin === entry.origin && url.pathname === entry.pathname) return observations.get(url.href);
	}
}
