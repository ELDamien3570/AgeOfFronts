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
