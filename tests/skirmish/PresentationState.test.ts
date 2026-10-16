import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { CanonicalStateStream } from "../../src/skirmish/client/CanonicalStateStream";
import { PresentationStateDecoder } from "../../src/skirmish/client/PresentationState";

function fixture() {
  const map = new GameMapImpl(64, 48, new Uint8Array(3072).fill(133), 3072);
  const game = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" });
  return { game, encoder: new SnapshotEncoder(true, { compactFormationSlots: true, compactTraders: true }),
    stream: new CanonicalStateStream(3072), receiver: new PresentationStateDecoder() };
}
describe("decoded entity presentation with sparse map obligations", () => {
  it("matches canonical state through dropped views, neutral reversions, removals and replacement baselines", () => {
    const { game, encoder, stream, receiver } = fixture();
    for (let at = 0; at < 50; at++) {
      game.step();
      const source = game.snapshot();
      source.owners[100] = at % 3 === 0 ? 0 : 2;
      source.claims[101] = at % 2;
      source.progress[101] = at % 255;
      if (at === 20) game.removeSquad(game.squads[0].id);
      stream.apply((at === 25 ? new SnapshotEncoder(true, { compactFormationSlots: true, compactTraders: true }) : encoder).encode(at === 20 ? game.snapshot() : source));
      const projected = stream.presentationState();
      const delivered = structuredClone(projected, { transfer: [projected.view.tiles.buffer] });
      // Deliberately drop alternating views: the next projection must contain
      // the full unacknowledged tile/geometry union, not an encoder delta.
      if (at % 2 === 0) continue;
      const expected = stream.presentation().snapshot;
      const actual = receiver.apply(delivered.view);
      expect(actual).toEqual(expected);
      (actual.squads[0] as { x: number }).x += 100;
      expect(stream.presentation().snapshot.squads[0].x).toBe(expected.squads[0].x);
      stream.acknowledge(delivered.canonicalSequence);
    }
  });
  it("sends only changed squad rows after a baseline and still equals the full view (N4 row view)", () => {
    const { game, encoder, stream, receiver } = fixture();
    const capture = () => encoder.encode(game.replicationSource(), game.tileChanges, game.replicationFacts());
    stream.apply(capture());
    const first = stream.presentationState();
    expect(first.view.squadMode).toBe("full");
    receiver.apply(structuredClone(first.view)); stream.acknowledge(first.canonicalSequence);
    let sawPartial = false, sawRemoval = false;
    for (let at = 0; at < 60; at++) {
      if (at === 10) game.removeSquad(game.squads[0].id);
      if (at === 30) game.removeSquad(game.squads[game.squads.length - 1].id);
      if (at % 7 === 3) { const s = game.squads[at % game.squads.length]; game.updateSquad(s.id, { x: s.x + 256 }); }
      game.step();
      stream.apply(capture());
      const projected = stream.presentationState();
      const delivered = structuredClone(projected, { transfer: [projected.view.tiles.buffer] });
      if (at % 3 === 1) continue; // dropped views keep their rows for the next one
      if (delivered.view.squadMode === "delta" && delivered.view.snapshot.squads.length < stream.presentation().snapshot.squads.length) sawPartial = true;
      if (delivered.view.removedSquads?.length) sawRemoval = true;
      expect(receiver.apply(delivered.view)).toEqual(stream.presentation().snapshot);
      stream.acknowledge(delivered.canonicalSequence);
    }
    expect(sawPartial).toBe(true);
    expect(sawRemoval).toBe(true);
    // A fresh receiver cannot apply a row delta.
    const view = stream.presentationState().view;
    if (view.squadMode === "delta") expect(() => new PresentationStateDecoder().apply({ ...view, reset: false })).toThrow(/baseline/);
  });
  it("retains changed geometry until its presented sequence is acknowledged", () => {
    const { game, encoder, stream, receiver } = fixture();
    stream.apply(encoder.encode(game.snapshot()));
    const first = stream.presentationState(); receiver.apply(structuredClone(first.view)); stream.acknowledge(first.canonicalSequence);
    const source = game.snapshot(); source.tick++;
    source.expansion!.roads = new Uint32Array([100, 101]);
    source.expansion!.roadRevision = (source.expansion!.roadRevision ?? 0) + 1;
    source.expansion!.deposits[0].owner = 2;
    stream.apply(encoder.encode(source));
    const dropped = stream.presentationState();
    expect(dropped.view.snapshot.expansion!.roads).toEqual(source.expansion!.roads);
    source.tick++; stream.apply(encoder.encode(source));
    const replacement = stream.presentationState();
    expect(replacement.view.snapshot.expansion!.roads).toEqual(source.expansion!.roads);
    expect(receiver.apply(structuredClone(replacement.view))).toEqual(stream.presentation().snapshot);
    stream.acknowledge(replacement.canonicalSequence);
    source.tick++; stream.apply(encoder.encode(source));
    const settled = stream.presentationState();
    expect(settled.view.snapshot.expansion!.roads).toBeUndefined();
    expect(settled.view.snapshot.expansion!.deposits).toBeUndefined();
    expect(receiver.apply(structuredClone(settled.view))).toEqual(stream.presentation().snapshot);
  });
  it("rejects a delta before baseline and rejects malformed network state without advancing the projection fence", () => {
    const { game, encoder, stream, receiver } = fixture();
    stream.apply(encoder.encode(game.snapshot()));
    const first = stream.presentationState(); stream.acknowledge(first.canonicalSequence);
    expect(() => receiver.apply({ ...first.view, reset: false })).toThrow("baseline");
    const source = game.snapshot(); source.tick++;
    const packet = encoder.encode(source);
    expect(() => stream.apply({ ...packet, tiles: new Uint32Array([3072, 1]) })).toThrow();
    stream.apply(packet);
    expect(stream.presentationState().canonicalSequence).toBe(first.canonicalSequence + 1);
  });
});
