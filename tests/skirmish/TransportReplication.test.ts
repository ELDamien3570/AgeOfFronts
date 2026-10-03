import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
describe("network transport lifecycle", () => {
  it("replicates boarding, sailing and afloat phases through full and sparse packets", () => {
    const data = new Uint8Array(80 * 50).fill(133),
      world = new Skirmish(new GameMapImpl(80, 50, data, data.length), {
        seed: 42,
        aiCount: 1,
        runAi: false,
      });
    const ship = world.addShip({
      id: world.allocateId(),
      playerId: 1,
      kind: "transport",
      x: 128,
      y: 128,
      health: 1000,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
      boarding: null,
      shoreTransfer: {
        phase: "boarding",
        capacity: 10,
        destinationTile: 50,
        landingTile: null,
        waterPath: [50],
        queued: [],
      },
    });
    const encoder = new SnapshotEncoder(true),
      decoder = new SnapshotDecoder();
    const packet = () =>
      encoder.encode(
        world.replicationSource(),
        world.tileChanges,
        world.replicationFacts(),
      );
    expect(
      decoder.decode(packet()).ships.find((s) => s.id === ship.id)
        ?.shoreTransfer,
    ).toEqual({
      phase: "boarding",
      capacity: 10,
      destinationTile: 50,
      landingTile: null,
    });
    for (const phase of ["sailing", "afloat"] as const) {
      world.updateShip(ship.id, {
        shoreTransfer: { ...ship.shoreTransfer!, phase },
      });
      const next = packet();
      expect(next.entityMode).toBe("delta");
      expect(
        decoder.decode(next).ships.find((s) => s.id === ship.id)?.shoreTransfer
          ?.phase,
      ).toBe(phase);
    }
    world.updateShip(ship.id, { shoreTransfer: undefined });
    expect(
      decoder.decode(packet()).ships.find((s) => s.id === ship.id)
        ?.shoreTransfer,
    ).toBeUndefined();
  });
});
