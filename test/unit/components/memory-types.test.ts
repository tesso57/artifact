import { expect, it } from "vitest";
import type { useMemory } from "../../../viewer/src/sdk/index";

function acceptsDeletion(set: ReturnType<typeof useMemory<string>>[1]) {
	set(undefined);
	set((previous) => previous ? undefined : "new value");
}

it("exposes deletion through the typed memory setter", () => {
	expect(acceptsDeletion).toBeTypeOf("function");
});
