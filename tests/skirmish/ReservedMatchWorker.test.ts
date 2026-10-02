import { describe, expect, it } from "vitest";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import type { MatchAdvance } from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { ReservedMatchWorker } from "../../src/skirmish/multiplayer/infrastructure/ReservedMatchWorker";
import type { EncodedState } from "../../src/skirmish/multiplayer/StateCodec";
import { decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";

const initialize = {
  type: "initialize" as const,
  settings: defaultLobbySettings("africa"),
  map: { width: 160, height: 100, terrain: new Uint8Array(16000).fill(133) },
  options: {
    seed: 77,
    aiCount: 0,
    humanNames: ["A", "B"],
    ruleset: "ages-v1" as const,
    tribes: false,
  },
};
const advance = (ticks: number, publish = true) => ({
  type: "advance" as const,
  ticks,
  commands: [],
  disconnectedPlayerIds: [],
  publish,
});

describe("reserved authoritative worker", () => {
  it("runs directly, emits an initial baseline and independently scheduled presentation deltas", async () => {
    const worker = new ReservedMatchWorker();
    try {
      const initial = await worker.request<MatchAdvance>(initialize);
      expect(initial.tick).toBe(0);
      expect(await decodeState<SnapshotPacket>(initial.packet!)).toMatchObject({
        tick: 0,
        reset: true,
      });
      const quiet = await worker.request<MatchAdvance>(advance(1, false));
      expect(quiet.tick).toBe(1);
      expect(quiet.packet).toBeUndefined();
      const update = await worker.request<MatchAdvance>(advance(3));
      expect(await decodeState<SnapshotPacket>(update.packet!)).toMatchObject({
        tick: 4,
        reset: false,
      });
      expect(Object.keys(update).sort()).toEqual([
        "packet",
        "rejectedCommands",
        "seats",
        "tick",
        "winner",
      ]);
      const baseline = await worker.request<EncodedState>({ type: "baseline" });
      expect(await decodeState<SnapshotPacket>(baseline)).toMatchObject({
        tick: 4,
        reset: true,
      });
      await expect(worker.request(advance(5))).rejects.toThrow(
        "Invalid match advance",
      );
      const next = await worker.request<MatchAdvance>(advance(1));
      expect(next.tick).toBe(5);
      expect(await decodeState<SnapshotPacket>(next.packet!)).toMatchObject({
        tick: 5,
        reset: false,
      });
    } finally {
      await worker.close();
    }
    await expect(worker.request({ type: "baseline" })).rejects.toThrow(
      "stopped",
    );
  }, 20_000);

  it("applies player commands once, preserves domain ownership and converts departures to AI", async () => {
    const worker = new ReservedMatchWorker();
    try {
      await worker.request<MatchAdvance>(initialize);
      const update = await worker.request<MatchAdvance>({
        ...advance(1),
        commands: [
          {
            id: "research",
            command: {
              type: "research",
              playerId: 2,
              technologyId: "stoneage-cargo-canoes",
            },
          },
        ],
      });
      const packet = await decodeState<SnapshotPacket>(update.packet!);
      expect(
        Object.values(packet.expansion!.progression[2].research).some(
          (job) => job?.technologyId === "stoneage-cargo-canoes",
        ),
      ).toBe(true);
      expect(
        Object.values(packet.expansion!.progression[1].research).some(
          (job) => job?.technologyId === "stoneage-cargo-canoes",
        ),
      ).toBe(false);
      const after = await worker.request<MatchAdvance>({
        ...advance(1),
        disconnectedPlayerIds: [1],
        commands: [
          { id: "departed", command: { type: "advance-age", playerId: 1 } },
        ],
      });
      expect(after.tick).toBe(2);
      expect(after.rejectedCommands).toEqual([
        {
          id: "departed",
          playerId: 1,
          message: "You are not active in this match",
        },
      ]);
      const state = await decodeState<SnapshotPacket>(after.packet!);
      expect(state.players[0].ai).toBe(true);
      expect(state.players[1].ai).toBe(false);
    } finally {
      await worker.close();
    }
  }, 20_000);
});
