import { afterEach, describe, expect, it, vi } from "vitest";
import { TerritoryLayer } from "../../src/skirmish/client/TerritoryLayer";
import type { Snapshot } from "../../src/skirmish/Protocol";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function state(width = 1000, height = 1000): Snapshot {
  return {
    tick: 0,
    width,
    height,
    owners: new Uint8Array(width * height),
    claims: new Uint8Array(width * height),
    progress: new Uint8Array(width * height),
    squads: [],
    buildings: [],
    ships: [],
    players: [],
    volleys: [],
    winner: null,
    combatTicks: 0,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("sparse initial network presentation", () => {
  it("does not transmit a million neutral tile indices and restores every occupied/contested field", () => {
    const source = state();
    source.owners[300] = 2;
    source.claims[850000] = 3;
    source.progress[850000] = 21;
    const encoded = new SnapshotEncoder(true).encode(source);
    expect(encoded.reset).toBe(true);
    expect(encoded.tiles.length).toBe(4);
    const decoded = new SnapshotDecoder().decode(encoded);
    expect(decoded.changedTiles).toBeUndefined();
    expect(
      decoded.owners.every((value, index) => value === source.owners[index]),
    ).toBe(true);
    expect(
      decoded.claims.every((value, index) => value === source.claims[index]),
    ).toBe(true);
    expect(
      decoded.progress.every(
        (value, index) => value === source.progress[index],
      ),
    ).toBe(true);
  });
  it("still sends a later change back to neutral and preserves ordinary delta semantics", () => {
    const source = state(10, 10),
      encoder = new SnapshotEncoder(true),
      decoder = new SnapshotDecoder();
    source.owners[7] = 1;
    decoder.decode(encoder.encode(source));
    source.tick = 4;
    source.owners[7] = 0;
    const next = encoder.encode(source);
    expect(next.reset).toBe(false);
    expect([...next.tiles]).toEqual([7, 0]);
    expect(decoder.decode(next).owners[7]).toBe(0);
  });
  it("clears old decoder arrays on another sparse initial baseline and leaves the local default unchanged", () => {
    const source = state(10, 10),
      decoder = new SnapshotDecoder();
    source.owners[7] = 1;
    decoder.decode(new SnapshotEncoder(true).encode(source));
    const blank = state(10, 10);
    expect(
      decoder.decode(new SnapshotEncoder(true).encode(blank)).owners[7],
    ).toBe(0);
    expect(new SnapshotEncoder().encode(blank).tiles.length).toBe(200);
  });
  it("initializes neutral territory render caches on a sparse reset", () => {
    vi.stubGlobal("Path2D", class {});
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
          putImageData: () => {},
        }),
      }),
    });
    const source = state(80, 4);
    source.owners[67] = 1;
    const decoded = new SnapshotDecoder().decode(
      new SnapshotEncoder(true).encode(source),
    );
    const layer = new TerritoryLayer(80, 4, [
      [0, 0, 0],
      [255, 0, 0],
    ]);
    layer.update(decoded);
    const rendered = (layer as unknown as { owners: Uint8Array }).owners;
    expect(rendered.every((owner, tile) => owner === source.owners[tile])).toBe(
      true,
    );
    expect(rendered.includes(255)).toBe(false);
  });
});
