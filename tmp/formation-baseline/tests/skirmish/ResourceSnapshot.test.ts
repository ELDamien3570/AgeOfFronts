import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

describe("resource facts and dynamic snapshot ownership", () => {
  it("sends facts once, preserves change-back deltas and fences a new baseline", () => {
    const map = new GameMapImpl(96, 64, new Uint8Array(6144).fill(133), 6144);
    const game = new Skirmish(map, {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
    const encoder = new SnapshotEncoder(true),
      decoder = new SnapshotDecoder(),
      source = game.snapshot();
    const first = encoder.encode(source),
      previous = decoder.decode(first),
      deposit = source.expansion!.deposits[0];
    const original = deposit.owner;
    deposit.owner = 2;
    source.tick++;
    const changed = encoder.encode(source);
    expect(changed.expansion!.deposits).toBeUndefined();
    expect([...changed.expansion!.depositOwners!]).toEqual([deposit.id, 2]);
    expect(
      decoder
        .decode(changed)
        .expansion!.deposits.find((d) => d.id === deposit.id)!.owner,
    ).toBe(2);
    expect(
      previous.expansion!.deposits.find((d) => d.id === deposit.id)!.owner,
    ).toBe(original);
    expect(
      first.expansion!.deposits!.find((d) => d.id === deposit.id)!.owner,
    ).toBe(original);
    deposit.owner = original;
    source.tick++;
    expect(decoder.decode(encoder.encode(source)).expansion!.deposits).toEqual(
      source.expansion!.deposits,
    );
    deposit.tile = map.ref(3, 3);
    source.tick++;
    expect(encoder.encode(source).expansion!.deposits).toEqual(
      source.expansion!.deposits,
    );
    expect(
      decoder.decode(new SnapshotEncoder(true).encode(source)).expansion!
        .deposits,
    ).toEqual(source.expansion!.deposits);
  });
});
