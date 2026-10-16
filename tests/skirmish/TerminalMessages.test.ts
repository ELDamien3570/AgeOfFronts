import { describe, expect, it, vi } from "vitest";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import {
  MATCH_EXECUTOR_FAILED_MESSAGE,
  MATCH_INITIALIZATION_FAILED_MESSAGE,
  MATCH_STOPPED_MESSAGE,
  publicExecutorError,
  publicInitializationMessage,
  publicStopMessage,
} from "../../src/skirmish/multiplayer/application/TerminalMessages";
import { ReservedMatchWorker } from "../../src/skirmish/multiplayer/infrastructure/ReservedMatchWorker";

const internal = new TypeError("Cannot read properties of undefined (reading 'kind')");

describe("public terminal messages", () => {
  it("logs the raw failure and returns one fixed stop string without a trailing period", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(publicStopMessage(internal)).toBe(MATCH_STOPPED_MESSAGE);
      expect(log).toHaveBeenCalledWith(expect.any(String), internal);
      expect(MATCH_STOPPED_MESSAGE.endsWith(".")).toBe(false);
      expect(MATCH_INITIALIZATION_FAILED_MESSAGE.endsWith(".")).toBe(false);
    } finally {
      log.mockRestore();
    }
  });
  it("keeps actionable setup failures but hides internal initialization text", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(publicInitializationMessage(internal)).toBe(MATCH_INITIALIZATION_FAILED_MESSAGE);
      const room = new Error("Not enough room for these factions and tribes. Choose fewer opponents or a larger battlefield.");
      expect(publicInitializationMessage(room)).toBe(room.message);
      expect(publicInitializationMessage("not an error")).toBe(MATCH_INITIALIZATION_FAILED_MESSAGE);
    } finally {
      log.mockRestore();
    }
  });
  it("maps worker request failures to deliberate messages only", () => {
    expect(publicExecutorError(internal)).toBe(MATCH_EXECUTOR_FAILED_MESSAGE);
    expect(publicExecutorError(new Error("This faction is no longer available"))).toBe("This faction is no longer available");
  });
  it("the reserved worker posts a fixed string for internal failures and keeps deliberate ones", async () => {
    const worker = new ReservedMatchWorker();
    try {
      await worker.request({
        type: "initialize",
        settings: defaultLobbySettings("africa"),
        map: { width: 160, height: 100, terrain: new Uint8Array(16000).fill(133) },
        options: { seed: 77, aiCount: 0, humanNames: ["A", "B"], ruleset: "ages-v1", tribes: false },
      });
      // A malformed request makes the worker read a property of undefined.
      await expect(worker.request({ type: "advance", ticks: 1, commands: undefined as never,
        disconnectedPlayerIds: [], publish: false })).rejects.toThrow(new RegExp(`^${MATCH_EXECUTOR_FAILED_MESSAGE}$`));
      await expect(worker.request({ type: "advance", ticks: 99, commands: [],
        disconnectedPlayerIds: [], publish: false })).rejects.toThrow("Invalid match advance");
    } finally {
      await worker.close();
    }
  }, 20_000);
  it("a worker terminated while idle reports a stopped lifecycle", async () => {
    const worker = new ReservedMatchWorker();
    expect(worker.lifecycle.state).toBe("running");
    await (worker as unknown as { worker: { terminate(): Promise<number> } }).worker.terminate();
    await vi.waitFor(() => expect(worker.lifecycle).toMatchObject({ state: "stopped", cause: "exit" }));
  }, 20_000);
});
