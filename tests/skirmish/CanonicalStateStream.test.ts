import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { CanonicalStateStream } from "../../src/skirmish/client/CanonicalStateStream";
import { ClientStateFlow } from "../../src/skirmish/multiplayer/application/ClientStateFlow";

describe("ordered canonical state and fenced flow control", () => {
  it("fences the first baseline to the loaded map even when forged dimensions have the same cell count", () => {
    const map = new GameMapImpl(64, 48, new Uint8Array(3072).fill(133), 3072);
    const match = new Skirmish(map, {
      seed: 42,
      aiCount: 1,
      tribes: false,
      runAi: false,
    });
    const packet = new SnapshotEncoder(true).encode(match.snapshot());
    const stream = new CanonicalStateStream(3072, 65_536, {
      width: 64,
      height: 48,
    });
    expect(() => stream.apply({ ...packet, width: 48, height: 64 })).toThrow(
      "loaded map",
    );
    stream.apply(packet);
    expect(stream.presentation().canonicalSequence).toBe(1);
  });
  it("falls back to a full frame when the dirty union exceeds its allowance and fences older acknowledgements", () => {
    const map = new GameMapImpl(64, 48, new Uint8Array(3072).fill(133), 3072),
      game = new Skirmish(map, {
        seed: 42,
        aiCount: 1,
        tribes: false,
        runAi: false,
      });
    const encoder = new SnapshotEncoder(true),
      stream = new CanonicalStateStream(3072, 1);
    stream.apply(encoder.encode(game.snapshot()));
    stream.acknowledge(1);
    game.tick = 4;
    game.owners[100] = 2;
    stream.apply(encoder.encode(game.snapshot()));
    game.tick = 8;
    game.owners[101] = 2;
    stream.apply(encoder.encode(game.snapshot()));
    expect(stream.presentation().snapshot.changedTiles).toBeUndefined();
    stream.acknowledge(2);
    expect(stream.presentation().snapshot.changedTiles).toBeUndefined();
    game.tick = 12;
    game.owners[102] = 2;
    stream.apply(encoder.encode(game.snapshot()));
    stream.acknowledge(3);
    expect([...stream.presentation().snapshot.changedTiles!]).toEqual([102]);
    expect(stream.presentation().snapshot.owners.slice(100, 103)).toEqual(
      new Uint8Array([2, 2, 2]),
    );
  });
  it("rejects oversized or changing dimensions before allocating canonical maps", () => {
    const map = new GameMapImpl(64, 48, new Uint8Array(3072).fill(133), 3072),
      game = new Skirmish(map, {
        seed: 42,
        aiCount: 1,
        tribes: false,
        runAi: false,
      });
    const baseline = new SnapshotEncoder(true).encode(game.snapshot()),
      stream = new CanonicalStateStream(3072);
    expect(() =>
      stream.apply({ ...baseline, width: 1_000_000, height: 1_000_000 }),
    ).toThrow("memory budget");
    stream.apply(baseline);
    expect(() => stream.apply({ ...baseline, width: 48, height: 64 })).toThrow(
      "dimensions changed",
    );
    expect(() =>
      stream.apply({ ...baseline, tiles: new Uint32Array([3072, 1]) }),
    ).toThrow("outside the map");
    const squads = baseline.squads.slice();
    squads[13] = 1_000_000_000;
    expect(() => stream.apply({ ...baseline, squads })).toThrow("order range");
    expect(stream.presentation().canonicalSequence).toBe(1);
  });
  it("preserves tile change-and-return and building deltas through presentation coalescing", () => {
    const map = new GameMapImpl(64, 48, new Uint8Array(3072).fill(133), 3072),
      game = new Skirmish(map, {
        seed: 42,
        aiCount: 1,
        tribes: false,
        runAi: false,
      });
    const encoder = new SnapshotEncoder(true),
      decoder = new SnapshotDecoder(),
      stream = new CanonicalStateStream();
    const initial = encoder.encode(game.snapshot());
    stream.apply(initial);
    decoder.decode(initial);
    stream.acknowledge(1);
    game.tick = 4;
    game.owners[100] = 2;
    game.buildings.push({
      id: 999,
      playerId: 1,
      type: "factory",
      tile: 200,
      remainingTicks: 0,
    });
    const first = encoder.encode(game.snapshot());
    stream.apply(first);
    decoder.decode(first);
    game.tick = 8;
    game.owners[100] = 0;
    game.buildings.pop();
    const last = encoder.encode(game.snapshot());
    stream.apply(last);
    const expected = decoder.decode(last),
      actual = stream.presentation();
    expect(actual.snapshot.owners).toEqual(expected.owners);
    expect(actual.snapshot.buildings).toEqual(expected.buildings);
    expect(actual.snapshot.changedTiles).toContain(100);
    expect(actual.canonicalSequence).toBe(3);
    actual.snapshot.owners[100] = 255;
    expect(stream.presentation().snapshot.owners[100]).toBe(0);
    stream.acknowledge(2);
    expect(stream.presentation().snapshot.changedTiles).toContain(100);
    stream.acknowledge(3);
    expect(stream.presentation().snapshot.changedTiles).toHaveLength(0);
  });
  it("allows one outstanding publication and requires a baseline after skipped deltas", () => {
    const flow = new ClientStateFlow(1);
    expect(flow.offer(1)).toBe(true);
    expect(flow.offer(2)).toBe(false);
    expect(flow.applied(1, 1)).toBe("baseline");
    expect(flow.beginBaseline()).toBe(true);
    expect(flow.offer(3)).toBe(false);
    flow.baseline(4, true);
    expect(flow.applied(1, 1)).toBe("ignored");
    expect(flow.applied(4, 2)).toBe("baseline");
    flow.beginBaseline();
    flow.baseline(5, false);
    expect(flow.applied(5, 3)).toBe("credit");
    expect(flow.offer(6)).toBe(true);
  });
});
