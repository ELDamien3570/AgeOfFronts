import { describe, expect, it } from "vitest";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import type { VerifiedCommit } from "../../src/skirmish/multiplayer/application/CommitVerifier";
import type { RuntimeCommit } from "../../src/skirmish/multiplayer/application/HostedRuntime";
import { ReservedMatchWorker } from "../../src/skirmish/multiplayer/infrastructure/ReservedMatchWorker";
import type { EncodedState } from "../../src/skirmish/multiplayer/StateCodec";
import { decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";

describe("reserved match isolation", () => {
  it("initializes, verifies and advances fallback in a real worker thread", async () => {
    const worker = new ReservedMatchWorker();
    try {
      const initial = await worker.request<VerifiedCommit>({
        type: "initialize",
        settings: defaultLobbySettings("africa"),
        map: {
          width: 160,
          height: 100,
          terrain: new Uint8Array(16000).fill(133),
        },
        options: {
          seed: 77,
          aiCount: 2,
          humanNames: ["A", "B"],
          ruleset: "ages-v1",
          tribes: false,
        },
      });
      expect(initial.tick).toBe(0);
      const batch = {
        previousTick: 0,
        commands: [],
        disconnectedPlayerIds: [],
      };
      const proposal = await worker.request<RuntimeCommit>({
        type: "fallback",
        batch,
      });
      const commit = await worker.request<VerifiedCommit>({
        type: "verify",
        batch,
        proposal,
      });
      const snapshot = await worker.request<EncodedState>({
        type: "accept",
        commit,
      });
      expect((await decodeState<SnapshotPacket>(snapshot)).tick).toBe(4);
    } finally {
      await worker.close();
    }
    await expect(worker.request({ type: "baseline" })).rejects.toThrow(
      "stopped",
    );
  }, 20_000);
});
