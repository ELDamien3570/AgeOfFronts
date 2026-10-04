import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { CanonicalStateStream } from "../../src/skirmish/client/CanonicalStateStream";
import { EntityChangeJournal } from "../../src/skirmish/EntityChangeJournal";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

describe("barrier lifecycle deltas", () => {
  it("retains unchanged transfer geometry and applies every missed state delta before projection", () => {
    const terrain = new Uint8Array(64 * 48).fill(133),
      game = new Skirmish(new GameMapImpl(64, 48, terrain, terrain.length), {
        seed: 47,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      });
    const forts = game.expansion!.fortifications;
    const wall = forts.addBarrier({
      id: 500,
      playerId: 1,
      age: "StoneAge",
      a: 1,
      b: 2,
      tiles: [100, 101],
      health: 100,
      maxHealth: 100,
      remainingTicks: 0,
    });
    const encoder = new SnapshotEncoder(true),
      stream = new CanonicalStateStream(terrain.length);
    const apply = () =>
      stream.apply(
        encoder.encode(
          game.replicationSource(),
          game.tileChanges,
          game.replicationFacts(),
        ),
      );
    apply();
    const first = stream.presentationForTransfer(),
      delivered = structuredClone(first);
    apply();
    const quiet = stream.presentationForTransfer();
    expect(quiet.snapshot.expansion!.barriers).toBe(
      first.snapshot.expansion!.barriers,
    );
    forts.updateBarrier(wall.id, { health: 80 });
    apply();
    forts.updateBarrier(wall.id, { health: 50 });
    apply();
    const latest = stream.presentationForTransfer();
    expect(latest.snapshot.expansion!.barriers[0]).toMatchObject({
      health: 50,
    });
    expect(latest.snapshot.expansion!.barriers[0].tiles).toBe(
      first.snapshot.expansion!.barriers[0].tiles,
    );
    expect(delivered.snapshot.expansion!.barriers[0].health).toBe(100);
    expect(first.snapshot.expansion!.barriers[0].health).toBe(100);
    expect(stream.presentation().snapshot.expansion!.barriers).toEqual(
      latest.snapshot.expansion!.barriers,
    );
  });
  it("rejects missing geometry before mutating canonical presentation obligations", () => {
    const terrain = new Uint8Array(64 * 48).fill(133),
      game = new Skirmish(new GameMapImpl(64, 48, terrain, terrain.length), {
        seed: 47,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      });
    const encoder = new SnapshotEncoder(true),
      stream = new CanonicalStateStream(terrain.length);
    stream.apply(
      encoder.encode(
        game.replicationSource(),
        game.tileChanges,
        game.replicationFacts(),
      ),
    );
    const before = stream.presentation();
    const delta = encoder.encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    expect(() =>
      stream.apply({
        ...delta,
        barrierChanges: {
          reset: false,
          rows: [],
          removed: new Int32Array(),
          states: [{ id: 999, health: 1, remainingTicks: 0 }],
        },
      }),
    ).toThrow("geometry baseline");
    expect(stream.presentation()).toEqual(before);
    stream.apply(delta);
    expect(stream.presentation().canonicalSequence).toBe(2);
  });
  it("matches full snapshots through construction, damage, repair, removal, lag and restore", () => {
    const terrain = new Uint8Array(64 * 48).fill(133),
      game = new Skirmish(new GameMapImpl(64, 48, terrain, terrain.length), {
        seed: 47,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      });
    const forts = game.expansion!.fortifications,
      encoder = new SnapshotEncoder(true),
      decoder = new SnapshotDecoder();
    const tower = game.addBuilding({
      id: game.allocateId(),
      playerId: 1,
      type: "tower",
      age: "StoneAge",
      tile: game.map.ref(20, 20),
      remainingTicks: 0,
    });
    const compare = () => {
      const packet = encoder.encode(
        game.replicationSource(),
        game.tileChanges,
        game.replicationFacts(),
      );
      expect(decoder.decode(packet).expansion!.barriers).toEqual(
        game.snapshot().expansion!.barriers,
      );
      return packet;
    };
    compare();
    const template = {
      id: 500,
      playerId: 1,
      age: "StoneAge" as const,
      a: tower.id,
      b: tower.id,
      tiles: [game.map.ref(20, 20), game.map.ref(21, 20)],
      health: 100,
      maxHealth: 100,
      remainingTicks: 2,
    };
    const wall = forts.addBarrier(template);
    template.tiles[0] = 0;
    expect(wall.tiles[0]).not.toBe(0);
    expect(compare().barrierChanges?.rows).toHaveLength(1);
    expect(compare().barrierChanges).toBeUndefined();
    expect(compare().expansion?.barriers).toBeUndefined();
    forts.updateBarrier(wall.id, { remainingTicks: 1 });
    expect(compare().barrierChanges?.states![0].remainingTicks).toBe(1);
    forts.updateBarrier(wall.id, { health: 30 });
    expect(compare().barrierChanges?.states![0].health).toBe(30);
    forts.updateBarrier(wall.id, { health: 100 });
    compare();
    // Independent consumers and restore invalidation must not lose health rows.
    new SnapshotEncoder(true).encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    forts.updateBarrier(wall.id, { health: 20 });
    compare();
    forts.forgetBuilding(tower, []);
    expect(compare().barrierChanges?.removed).toEqual(new Int32Array([500]));
    forts.addBarrier({ ...template, tiles: [game.map.ref(20, 20)] });
    game.restore(game.checkpoint());
    expect(compare().expansionMode).toBe("full");
    const facts = game.replicationFacts();
    facts.barriers!.journal = new EntityChangeJournal(1);
    const lagging = new SnapshotEncoder(true),
      lagDecoder = new SnapshotDecoder();
    lagDecoder.decode(
      lagging.encode(game.replicationSource(), game.tileChanges, facts),
    );
    facts.barriers!.journal.record(500, "change");
    facts.barriers!.journal.record(501, "remove");
    const reset = lagging.encode(
      game.replicationSource(),
      game.tileChanges,
      facts,
    );
    expect(reset.barrierChanges?.reset).toBe(true);
    expect(lagDecoder.decode(reset).expansion!.barriers).toEqual(
      game.snapshot().expansion!.barriers,
    );
  });
});
