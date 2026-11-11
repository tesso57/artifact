import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArtifactsRuntime } from "../../../extension/runtime.ts";

let previousState: string | undefined;
let testState: string;

beforeEach(() => {
	previousState = process.env.PI_ARTIFACTS_STATE;
	testState = mkdtempSync(join(tmpdir(), "pi-runtime-lifecycle-"));
	process.env.PI_ARTIFACTS_STATE = testState;
});

afterEach(() => {
	vi.restoreAllMocks();
	if (previousState === undefined) delete process.env.PI_ARTIFACTS_STATE;
	else process.env.PI_ARTIFACTS_STATE = previousState;
	rmSync(testState, { recursive: true, force: true });
});

it("does not register after shutdown while checking for an existing viewer", async () => {
	const runtime = new ArtifactsRuntime({ getAllTools: () => [] } as unknown as ExtensionAPI);
	let release!: (running: boolean) => void;
	vi.spyOn(runtime.daemon, "running").mockImplementation(() => new Promise((resolve) => { release = resolve; }));
	const connect = vi.spyOn(runtime, "connect").mockResolvedValue();
	const checking = runtime.connectIfRunning();
	await runtime.shutdown();
	release(true);
	await checking;
	expect(connect).not.toHaveBeenCalled();
});

it("removes a registration that completes after shutdown has started", async () => {
	const runtime = new ArtifactsRuntime({ getAllTools: () => [] } as unknown as ExtensionAPI);
	let release!: () => void;
	let started!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const requestStarted = new Promise<void>((resolve) => { started = resolve; });
	let registered = false;
	vi.spyOn(runtime.daemon, "api").mockImplementation(async (path) => {
		if (path === "/sessions/register") { started(); await gate; registered = true; }
		if (path === "/sessions/unregister") registered = false;
		return {} as never;
	});
	try {
		const connecting = runtime.connect();
		await requestStarted;
		const closing = runtime.shutdown();
		await Promise.resolve();
		await Promise.resolve();
		release();
		await Promise.all([connecting, closing]);
		expect(registered).toBe(false);
	} finally {
		release();
		await runtime.shutdown();
	}
});

it("waits for a background re-registration before unregistering", async () => {
	const runtime = new ArtifactsRuntime({ getAllTools: () => [] } as unknown as ExtensionAPI);
	let release!: () => void;
	let started!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const requestStarted = new Promise<void>((resolve) => { started = resolve; });
	let registrations = 0;
	let registered = false;
	vi.spyOn(runtime.daemon, "api").mockImplementation(async (path) => {
		if (path === "/sessions/register") {
			if (++registrations === 2) { started(); await gate; }
			registered = true;
		}
		if (path === "/sessions/unregister") registered = false;
		return {} as never;
	});
	try {
		await runtime.connect();
		runtime.captureToolContext({ executeTool: async () => ({}), sessionManager: { getSessionId: () => runtime.id } } as never);
		await requestStarted;
		const closing = runtime.shutdown();
		await new Promise<void>((resolve) => setImmediate(resolve));
		release();
		await closing;
		expect(registered).toBe(false);
	} finally {
		release();
		await runtime.shutdown();
	}
});

it("does not wait for daemon startup when the session shuts down", async () => {
	const runtime = new ArtifactsRuntime({ getAllTools: () => [] } as unknown as ExtensionAPI);
	let release!: (state: never) => void;
	let started!: () => void;
	const startedPromise = new Promise<void>((resolve) => { started = resolve; });
	vi.spyOn(runtime.daemon, "ensure").mockImplementation(() => {
		started();
		return new Promise((resolve) => { release = resolve; });
	});
	const fetch = vi.spyOn(globalThis, "fetch");
	const connecting = runtime.connect();
	void connecting.catch(() => {});
	await startedPromise;
	const closing = runtime.shutdown();
	const result = await Promise.race([closing.then(() => "closed"), new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 200))]);
	release({ url: "http://127.0.0.1:9", secret: "x" } as never);
	await Promise.allSettled([connecting, closing]);
	expect(result).toBe("closed");
	expect(fetch).not.toHaveBeenCalled();
	fetch.mockRestore();
});
