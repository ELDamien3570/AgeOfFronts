import { describe, expect, it } from "vitest";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { mapIdentity } from "../../src/skirmish/multiplayer/application/MapIdentity";
import type {
  MatchAdvance,
  PreparedMatch,
} from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { ReservedMatchWorker } from "../../src/skirmish/multiplayer/infrastructure/ReservedMatchWorker";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";
import { SnapshotDecoder } from "../../src/skirmish/SnapshotCodec";

describe("procedural Black Forest in the authoritative worker", () => {
  it("prepares the requested seed, starts the roster, and publishes coherent state", async () => {
    const settings = {
        ...defaultLobbySettings("black-forest", 250),
        aiCount: 2,
        tribeCount: 4,
      },
      options = {
        seed: 2026,
        aiCount: 2,
        tribeCount: 4,
        tribes: true,
        humanNames: ["A", "B"],
        ruleset: "ages-v1" as const,
        runAi: false,
      },
      loaded = await loadServerMap(settings, undefined, options.seed),
      worker = new ReservedMatchWorker();
    try {
      const prepared = await worker.request<PreparedMatch>({
        type: "prepare",
        settings,
        options,
      });
      expect(prepared.mapHash).toBe(await mapIdentity(loaded.map));
      const initial = await worker.request<MatchAdvance>({ type: "start" });
      const decoder = new SnapshotDecoder(),
        snapshot = decoder.decode(
          await decodeState<SnapshotPacket>(initial.packet!),
        );
      expect(snapshot.players).toHaveLength(8);
      expect(snapshot.width).toBe(250);
      expect(snapshot.height).toBe(250);
      expect(snapshot.expansion).toBeDefined();
      const advanced = await worker.request<MatchAdvance>({
        type: "advance",
        ticks: 4,
        commands: [],
        disconnectedPlayerIds: [],
        publish: true,
      });
      expect(advanced.tick).toBe(4);
      expect(
        decoder.decode(await decodeState<SnapshotPacket>(advanced.packet!))
          .tick,
      ).toBe(4);
    } finally {
      await worker.close();
    }
  }, 30_000);
});
