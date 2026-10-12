import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotEncoder, snapshotTransfers } from "../../src/skirmish/SnapshotCodec";
import { LocalSnapshotStream } from "../../src/skirmish/client/LocalSnapshotStream";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";

function fixture() {
  const terrain = new Uint8Array(64 * 48).fill(133);
  const game = new Skirmish(new GameMapImpl(64, 48, terrain, terrain.length), {
    seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
  });
  let encoder = new SnapshotEncoder(), requests = 0;
  const stream = new LocalSnapshotStream(() => requests++);
  const packet = () => {
    const data = encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    return structuredClone(data, { transfer: snapshotTransfers(data) });
  };
  const reset = () => { encoder = new SnapshotEncoder(); return packet(); };
  return { game, stream, packet, reset, requests: () => requests };
}

describe("local worker stream recovery", () => {
  it("recovers the missed barrier geometry and all other state after a rejected delta", () => {
    const f = fixture();
    expect(f.stream.decode(f.packet())!.tick).toBe(0);
    const forts = f.game.expansion!.fortifications;
    const wall = forts.addBarrier({ id: 500, playerId: 1, age: "StoneAge", a: 1, b: 2,
      tiles: [100, 101], health: 100, maxHealth: 100, remainingTicks: 0 });
    const bad = f.packet();
    // This packet carries the barrier addition, but fails validation first.
    bad.orders = new Int32Array([1]);
    expect(f.stream.decode(bad)).toBeUndefined();
    expect(f.requests()).toBe(1);
    forts.updateBarrier(wall.id, { health: 80 });
    f.game.step();
    expect(f.stream.decode(f.packet())).toBeUndefined();
    expect(f.requests()).toBe(1);
    const recovered = f.stream.decode(f.reset())!;
    expect(recovered.tick).toBe(f.game.tick);
    expect(recovered.expansion!.barriers).toEqual(f.game.snapshot().expansion!.barriers);
    const id = f.game.squads[0].id;
    f.game.updateSquad(id, { moved: true });
    expect(f.stream.decode(f.packet())!.squads.find(s => s.id === id)!.moved).toBe(true);
  });

  it("surfaces an invalid recovery baseline instead of requesting forever", () => {
    const f = fixture(); f.stream.decode(f.packet());
    const bad = f.packet(); bad.orders = new Int32Array([1]);
    f.stream.decode(bad);
    const baseline = f.reset(); baseline.orders = new Int32Array([1]);
    expect(() => f.stream.decode(baseline)).toThrow();
    expect(f.requests()).toBe(1);
  });

  it("fails an invalid initial baseline immediately", () => {
    const f = fixture(), bad = f.packet(); bad.orders = new Int32Array([1]);
    expect(() => f.stream.decode(bad)).toThrow();
    expect(f.requests()).toBe(0);
  });

  it("requests a new baseline for a later independent discontinuity", () => {
    const f = fixture(); f.stream.decode(f.packet());
    for (let i = 0; i < 2; i++) {
      const bad: SnapshotPacket = f.packet(); bad.orders = new Int32Array([1]);
      expect(f.stream.decode(bad)).toBeUndefined();
      expect(f.stream.decode(f.reset())).toBeDefined();
    }
    expect(f.requests()).toBe(2);
  });
});
