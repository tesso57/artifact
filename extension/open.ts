import { spawn } from "node:child_process";

/** How to open a URL on this platform (exported for tests). */
export function openerCommand(url: string, platform = process.platform): [string, string[]] {
	if (platform === "darwin") return ["open", [url]];
	// `cmd /c start` would split the URL at "&"; the URL protocol handler takes it whole.
	if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
	return ["xdg-open", [url]];
}

/** Open a URL in the user's browser; returns false when no opener is available. */
export function openInBrowser(url: string): Promise<boolean> {
	const [cmd, args] = openerCommand(url);
	return new Promise((resolve) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (opened: boolean) => { clearTimeout(timer); resolve(opened); };
		try {
			const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
			child.once("error", () => finish(false));
			child.once("exit", (code) => finish(code === 0));
			// Some openers wait for the browser to exit; do not block the Pi command on them.
			child.once("spawn", () => { child.unref(); timer = setTimeout(() => finish(true), 750); });
		} catch { finish(false); }
	});
}
