import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotDecoder, SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { decodeState, encodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { SNAPSHOT_STATE_LIMITS } from "../../src/skirmish/multiplayer/StateLimits";
import { RuntimeDiagnostics } from "../../src/skirmish/RuntimeDiagnostics";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";

/** P13: the recruitment queue travels in an endTick wire form, sent only when
 * a job starts, finishes or stalls; the decoder rebuilds every countdown. */
function match() {
  const terrain = new Uint8Array(96 * 48).fill(133);
  const game = new Skirmish(new GameMapImpl(96, 48, terrain, terrain.length), { seed: 9, aiCount: 2, tribes: false, ruleset: "ages-v1", infiniteGoldForPlayers: true });
  return game;
}
const wire = async (packet: SnapshotPacket) =>
  decodeState<SnapshotPacket>(await encodeState(packet, new RuntimeDiagnostics(), SNAPSHOT_STATE_LIMITS, true), SNAPSHOT_STATE_LIMITS);
const recruit = (game: Skirmish, playerId: number) => {
  const barracks = game.buildings.find((b) => b.playerId === playerId && b.type === "barracks" && !b.remainingTicks);
  return barracks ? game.applyCommand({ type: "recruit", playerId, buildingId: barracks.id }) : "no barracks";
};

describe("recruitment replication (P13)", () => {
  it("decodes the authoritative queue every tick while sending it only when it changes", async () => {
    const game = match();
    const encoder = new SnapshotEncoder(true, { compactFormationSlots: true, compactTraders: true }), decoder = new SnapshotDecoder();
    const capture = () => encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    const first = await wire(capture());
    expect(first.recruitmentMode).toBe("full");
    decoder.decode(first);
    let sentJobs = 0, presentJobs = 0;
    for (let step = 1; step <= 200; step++) {
      if (step % 29 === 1) recruit(game, 1);
      game.step();
      const packet = await wire(capture());
      expect(packet.recruitmentMode).toBe("delta");
      const changes = (packet.expansion?.recruitment ?? {}) as unknown as Record<number, unknown[]>;
      sentJobs += Object.values(changes).reduce((n, list) => n + list.length, 0);
      presentJobs += game.recruitment.jobs.length;
      const decoded = decoder.decode(packet);
      expect(decoded.expansion!.recruitment).toEqual(JSON.parse(JSON.stringify(game.recruitment.jobs)));
    }
    expect(presentJobs).toBeGreaterThan(0);
    // A running countdown alone never resends its faction's jobs.
    expect(sentJobs).toBeLessThan(presentJobs / 4);
  });

  it("still decodes a legacy remainingTicks queue and rejects a delta without a baseline", () => {
    const game = match();
    recruit(game, 1); game.step();
    const legacy = new SnapshotEncoder().encode(game.replicationSource());
    delete legacy.recruitmentMode;
    legacy.expansion!.recruitment = structuredClone(game.recruitment.jobs);
    expect(new SnapshotDecoder().decode(legacy).expansion!.recruitment).toEqual(JSON.parse(JSON.stringify(game.recruitment.jobs)));
    const orphan = new SnapshotEncoder().encode(game.replicationSource());
    orphan.reset = false; orphan.expansionMode = "delta"; delete orphan.expansion!.recruitment;
    expect(() => new SnapshotDecoder().decode(orphan)).toThrow();
  });
});
