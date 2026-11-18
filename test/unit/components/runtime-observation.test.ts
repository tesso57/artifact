import { afterEach, expect, it, vi } from "vitest";
import { registerRuntimeObservation, runtimeObservation } from "../../../viewer/src/lib/runtime-observation.ts";

afterEach(() => vi.unstubAllGlobals());

it("uses the executed module URL and leaves unattributable reports unassigned", () => {
	vi.stubGlobal("location", new URL("http://localhost/"));
	const entry = "http://localhost/artifact/index.tsx";
	const older = `${entry}?t=1`;
	const newer = `${entry}?t=2`;
	const untagged = `${entry}?t=3`;
	registerRuntimeObservation(older, "first");
	registerRuntimeObservation(newer, "second");

	const olderFrame = `    at delayedCallback (${older}:1:2)`;
	expect(runtimeObservation(entry, `Error: delayed\n${olderFrame}`)).toBe("first");
	expect(runtimeObservation(entry, undefined, newer)).toBe("second");
	expect(runtimeObservation(entry)).toBeUndefined();
	expect(runtimeObservation(entry, `Error: untagged\n    at update (${untagged}:1:2)\n${olderFrame}`)).toBeUndefined();
});
