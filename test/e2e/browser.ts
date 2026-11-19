import { chromium } from "playwright";

export function launchBrowser() {
	const executablePath = process.env.PLAYWRIGHT_CHROMIUM;
	return chromium.launch(executablePath ? { executablePath } : {});
}
