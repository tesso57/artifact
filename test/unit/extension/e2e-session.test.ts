import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import { startPi } from "../../e2e/pi.ts";

it("removes its temporary working directory when the test session closes", async () => {
	const session = await startPi();
	const cwd = session.cwd;
	expect(existsSync(cwd)).toBe(true);
	await session.close();
	expect(existsSync(cwd)).toBe(false);
	await expect(session.close()).resolves.toBeUndefined();
}, 20_000);
