import { spawn } from "node:child_process";

export function openerCommand(url: string, platform = process.platform): [string, string[]] {
	if (platform === "darwin") return ["open", [url]];
	if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
	return ["xdg-open", [url]];
}

export function openInBrowser(url: string): Promise<boolean> {
	const [cmd, args] = openerCommand(url);
	return new Promise((resolve) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (opened: boolean) => { clearTimeout(timer); resolve(opened); };
		try {
			const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
			child.once("error", () => finish(false));
			child.once("exit", (code) => finish(code === 0));
			child.once("spawn", () => { child.unref(); timer = setTimeout(() => finish(true), 750); });
		} catch { finish(false); }
	});
}
