import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotDecoder, SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { decodeState, encodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { SNAPSHOT_STATE_LIMITS } from "../../src/skirmish/multiplayer/StateLimits";
import { RuntimeDiagnostics } from "../../src/skirmish/RuntimeDiagnostics";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";
import { researchRejection } from "../../src/skirmish/domain/Progression";
import { availableGold } from "../../src/skirmish/domain/Gold";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { toWireProgression } from "../../src/skirmish/ProgressionReplication";

/** Fixture: 96x48 open land, 2 regular AI nations plus player 1, AI running. */
function match(seed = 11) {
  const terrain = new Uint8Array(96 * 48).fill(133);
  const map = new GameMapImpl(96, 48, terrain, terrain.length);
  const game = new Skirmish(map, { seed, aiCount: 2, tribes: false, ruleset: "ages-v1" as const, infiniteGoldForPlayers: true });
  return game;
}
const research = (game: Skirmish, playerId: number) => {
  const state = game.expansion!.progression.states[playerId], player = game.player(playerId)!;
  const technology = TECHNOLOGIES.find(t => !researchRejection(state, availableGold(player), t.id, game.expansion!.progression.technologySpeed));
  if (technology) game.applyCommand({ type: "research", playerId, technologyId: technology.id });
  return technology;
};
const wire = async (packet: SnapshotPacket) =>
  decodeState<SnapshotPacket>(await encodeState(packet, new RuntimeDiagnostics(), SNAPSHOT_STATE_LIMITS, true), SNAPSHOT_STATE_LIMITS);

describe("N5 progression replication (P12)", () => {
  it("decodes the authoritative progression every tick through deltas that omit unchanged factions", async () => {
    const game = match();
    const encoder = new SnapshotEncoder(true, { compactFormationSlots: true, compactTraders: true }), decoder = new SnapshotDecoder();
    const capture = () => encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    const first = await wire(capture());
    expect(first.progressionMode).toBe("full");
    decoder.decode(first);
    let sawDelta = false, sawResearch = false;
    for (let step = 1; step <= 160; step++) {
      if (step % 37 === 1) sawResearch = !!research(game, 1) || sawResearch;
      game.step();
      const packet = await wire(capture());
      const decoded = decoder.decode(packet);
      expect(decoded.expansion!.progression).toEqual(JSON.parse(JSON.stringify(game.expansion!.progression.states)));
      if (packet.progressionMode === "delta") {
        sawDelta = true;
        const sent = Object.keys(packet.expansion?.progression ?? {});
        // A running job alone never resends its faction.
        expect(sent.length).toBeLessThan(Object.keys(game.expansion!.progression.states).length);
      }
    }
    expect(sawDelta && sawResearch).toBe(true);
  });

  it("sends nothing for a faction whose research only counts down", async () => {
    const game = match();
    const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
    decoder.decode(encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts()));
    const technology = research(game, 1)!;
    game.step();
    decoder.decode(encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts()));
    game.step();
    const packet = encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    expect(packet.expansion?.progression?.[1]).toBeUndefined();
    const decoded = decoder.decode(packet);
    const job = Object.values(decoded.expansion!.progression[1].research).find(j => j?.technologyId === technology.id)!;
    expect(job.remainingTicks).toBe(Object.values(game.expansion!.progression.states[1].research).find(j => j?.technologyId === technology.id)!.remainingTicks);
  });

  it("still decodes a legacy packet whose progression is a remainingTicks map", () => {
    const game = match();
    research(game, 1); game.step();
    const packet = new SnapshotEncoder().encode(game.replicationSource());
    delete packet.progressionMode;
    packet.expansion!.progression = structuredClone(game.expansion!.progression.states);
    const decoded = new SnapshotDecoder().decode(packet);
    expect(decoded.expansion!.progression).toEqual(JSON.parse(JSON.stringify(game.expansion!.progression.states)));
  });

  it("rejects an unknown mode, a delta without baseline and an impossible job", () => {
    const game = match();
    research(game, 1); game.step();
    const encode = () => new SnapshotEncoder().encode(game.replicationSource());
    const unknown = encode();
    (unknown as { progressionMode?: string }).progressionMode = "sparse";
    expect(() => new SnapshotDecoder().decode(unknown)).toThrow(/progression mode/);
    const orphan = encode();
    orphan.reset = false; orphan.expansionMode = "delta"; orphan.progressionMode = "delta";
    expect(() => new SnapshotDecoder().decode(orphan)).toThrow();
    const bad = encode();
    const record = toWireProgression(game.expansion!.progression.states[1], game.tick);
    for (const job of Object.values(record.research)) job!.endTick = game.tick - 5;
    (bad.expansion!.progression as unknown as Record<number, unknown>)[1] = record;
    expect(() => new SnapshotDecoder().decode(bad)).toThrow(/progression job/);
  });
});
