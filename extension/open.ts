import { spawn } from "node:child_process";

/** How to open a URL on this platform (exported for tests). */
export function openerCommand(url: string, platform = process.platform): [string, string[]] {
	if (platform === "darwin") return ["open", [url]];
	// `cmd /c start` would split the URL at "&"; the URL protocol handler takes it whole.
	if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
	return ["xdg-open", [url]];
}

/** Open a URL in the user's browser; returns false when no opener is available. */
export function openInBrowser(url: string): boolean {
	const [cmd, args] = openerCommand(url);
	try {
		const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
		child.on("error", () => {});
		child.unref();
		return true;
	} catch {
		return false;
	}
}
