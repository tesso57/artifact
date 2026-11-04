/**
 * Playwright's chromium for the e2e scripts. CI installs browsers with
 * `npx playwright install chromium`; elsewhere PLAYWRIGHT_CHROMIUM can point at an
 * existing binary.
 */
import { chromium } from "playwright";

export function launchBrowser() {
	const executablePath = process.env.PLAYWRIGHT_CHROMIUM;
	return chromium.launch(executablePath ? { executablePath } : {});
}
