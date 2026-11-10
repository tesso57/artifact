import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { registerArtifactsCommand } from "../../../extension/command.ts";
import { ViewerNotRunningError } from "../../../extension/daemon-client.ts";
import { createMockPi } from "../../helpers/mock-pi.ts";

it("preserves spaces in an export destination", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-export-command-"));
	try {
		const mock = createMockPi();
		mock.context.cwd = cwd;
		const api = vi.fn(async () => ({ file: "report.html", bytes: 1, embedded: { memoryKeys: [], sharedKeys: [], mcpCalls: [] } }));
		const runtime = { attach: () => {}, daemon: { api } };
		registerArtifactsCommand(mock.pi, runtime as never);
		await mock.runCommand("artifacts", "export report folder/My  Report.html");
		expect(api).toHaveBeenCalledWith("/export", { id: "report", outFile: join(cwd, "folder", "My  Report.html"), overwrite: false });
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

it("requires confirmation before overwriting an export", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-export-overwrite-"));
	try {
		const target = join(cwd, "report.html");
		writeFileSync(target, "existing report");
		const mock = createMockPi({ confirm: [false, true] });
		mock.context.cwd = cwd;
		const api = vi.fn(async () => ({ file: target, bytes: 1, embedded: { memoryKeys: [], sharedKeys: [], mcpCalls: [] } }));
		registerArtifactsCommand(mock.pi, { attach: () => {}, daemon: { api } } as never);
		await mock.runCommand("artifacts", "export report report.html");
		expect(api).not.toHaveBeenCalled();
		expect(mock.notifications.at(-1)).toEqual({ message: "Export cancelled", type: "info" });
		await mock.runCommand("artifacts", "export report report.html");
		expect(mock.dialogs).toEqual([
			{ kind: "confirm", title: "Overwrite?", message: `${target} exists. Replace it?` },
			{ kind: "confirm", title: "Overwrite?", message: `${target} exists. Replace it?` },
		]);
		expect(api).toHaveBeenCalledOnce();
		expect(api).toHaveBeenCalledWith("/export", { id: "report", outFile: target, overwrite: true });
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

it("does not delete an artifact when confirmation is declined", async () => {
	const mock = createMockPi({ confirm: [false, true] });
	const api = vi.fn(async () => ({ deleted: true }));
	registerArtifactsCommand(mock.pi, { attach: () => {}, daemon: { api } } as never);
	await mock.runCommand("artifacts", "delete report");
	expect(api).not.toHaveBeenCalled();
	await mock.runCommand("artifacts", "delete report");
	expect(mock.dialogs).toHaveLength(2);
	expect(mock.dialogs[0]).toEqual({ kind: "confirm", title: "Delete artifact", message: 'Delete "report", its files and its memory?' });
	expect(api).toHaveBeenCalledOnce();
	expect(api).toHaveBeenCalledWith("/artifacts/delete", { id: "report" });
	expect(mock.notifications.at(-1)).toEqual({ message: "Deleted report", type: "info" });
});

it("does not open the viewer when artifact selection is cancelled", async () => {
	const mock = createMockPi({ select: [undefined] });
	const api = vi.fn(async () => [{ id: "report", title: "Status report" }]);
	const connect = vi.fn();
	registerArtifactsCommand(mock.pi, { attach: () => {}, connect, daemon: { api } } as never);
	await mock.runCommand("artifacts");
	expect(api).toHaveBeenCalledWith("/artifacts");
	expect(mock.dialogs[0]).toMatchObject({ kind: "select", options: ["▸ Open gallery", "Status report  (report)"] });
	expect(connect).not.toHaveBeenCalled();
});

it("reports whether stopping the viewer was requested, unnecessary, or failed", async () => {
	const mock = createMockPi();
	const api = vi.fn();
	registerArtifactsCommand(mock.pi, { attach: () => {}, daemon: { api } } as never);
	api.mockResolvedValueOnce({ ok: true });
	await mock.runCommand("artifacts", "stop");
	expect(mock.notifications.at(-1)).toEqual({ message: "Stopping artifact viewer", type: "info" });
	api.mockRejectedValueOnce(new ViewerNotRunningError());
	await mock.runCommand("artifacts", "stop");
	expect(mock.notifications.at(-1)).toEqual({ message: "Artifact viewer is not running", type: "info" });
	api.mockRejectedValueOnce(new Error("connection refused"));
	await mock.runCommand("artifacts", "stop");
	expect(mock.notifications.at(-1)).toEqual({ message: "Artifacts: connection refused", type: "error" });
});
