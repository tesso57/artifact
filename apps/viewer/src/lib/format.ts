const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function timeAgo(ts: number, now = Date.now()): string {
	const s = Math.round((ts - now) / 1000);
	const abs = Math.abs(s);
	if (abs < 60) return rtf.format(s, "second");
	if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
	if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
	return rtf.format(Math.round(s / 86400), "day");
}
