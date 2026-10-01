import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { RoadLayer } from "../../src/skirmish/client/RoadLayer";
import type { Snapshot } from "../../src/skirmish/Protocol";

afterEach(() => vi.unstubAllGlobals());
function fixture(loaded = true) {
  const contexts: { drawImage: ReturnType<typeof vi.fn> }[] = [];
  const images: {
    onload?: () => void;
    complete: boolean;
    naturalWidth: number;
  }[] = [];
  vi.stubGlobal(
    "Image",
    class {
      complete = loaded;
      naturalWidth = loaded ? 1040 : 0;
      onload?: () => void;
      constructor() {
        images.push(this);
      }
      set src(_source: string) {}
    },
  );
  vi.stubGlobal("document", {
    createElement: () => {
      const ctx = { drawImage: vi.fn() };
      contexts.push(ctx);
      return { width: 0, height: 0, getContext: () => ctx };
    },
  });
  const map = new GameMapImpl(
    96,
    64,
    new Uint8Array(96 * 64).fill(133),
    96 * 64,
  );
  const layer = new RoadLayer(map),
    screen = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  const packed = (...tiles: number[]) =>
    new Uint32Array(tiles.flatMap((t) => [t, 1, 5]));
  const snapshot = {
    buildings: [],
    expansion: {
      roadRevision: 1,
      roads: packed(map.ref(10, 10), map.ref(40, 10), map.ref(75, 10)),
    },
  } as unknown as Snapshot;
  const draw = (scale = 8) =>
    layer.draw(screen, scale, 0, 0, 96 * scale, 64 * scale);
  return { map, layer, screen, contexts, images, packed, snapshot, draw };
}
describe("cached road rendering", () => {
  it("draws dense roads by visible chunks and reuses unchanged chunks across snapshots", () => {
    const { layer, snapshot, screen, contexts, packed, draw } = fixture();
    snapshot.expansion!.roads = packed(
      ...Array.from({ length: 6144 }, (_, i) => i),
    );
    layer.update(snapshot);
    const before = snapshot.expansion!.roads.slice();
    draw();
    expect(contexts).toHaveLength(6);
    expect(screen.drawImage).toHaveBeenCalledTimes(6);
    const draws = contexts.reduce(
      (n, c) => n + c.drawImage.mock.calls.length,
      0,
    );
    layer.update(snapshot);
    draw();
    expect(contexts).toHaveLength(6);
    expect(
      contexts.reduce((n, c) => n + c.drawImage.mock.calls.length, 0),
    ).toBe(draws);
    expect(snapshot.expansion!.roads).toEqual(before);
  });
  it("invalidates only changed road chunks and building occupancy, including adjacent gutters", () => {
    const { map, layer, snapshot, contexts, packed, draw } = fixture();
    layer.update(snapshot);
    draw();
    expect(contexts).toHaveLength(3);
    snapshot.expansion!.roadRevision++;
    snapshot.expansion!.roads = packed(
      map.ref(10, 10),
      map.ref(40, 10),
      map.ref(75, 10),
      map.ref(31, 10),
    );
    layer.update(snapshot);
    draw();
    expect(contexts).toHaveLength(5);
    snapshot.buildings = [
      { tile: map.ref(75, 10), type: "factory" },
    ] as Snapshot["buildings"];
    layer.update(snapshot);
    draw();
    expect(contexts).toHaveLength(6);
    snapshot.buildings = [];
    layer.update(snapshot);
    draw();
    expect(contexts).toHaveLength(7);
  });
  it("recovers after atlas loading without rebuilding transparent chunks every frame", () => {
    const { layer, snapshot, contexts, images, draw } = fixture(false);
    layer.update(snapshot);
    draw();
    draw();
    expect(contexts).toHaveLength(3);
    expect(contexts.every((c) => !c.drawImage.mock.calls.length)).toBe(true);
    images[0].complete = true;
    images[0].naturalWidth = 1040;
    images[0].onload?.();
    draw();
    expect(contexts).toHaveLength(6);
    expect(
      contexts.slice(3).every((c) => c.drawImage.mock.calls.length > 0),
    ).toBe(true);
  });
  it("culls offscreen chunks, bounds cache memory across zooms, and preserves the road visibility threshold", () => {
    const { map, layer, snapshot, contexts, screen, packed, draw } = fixture();
    snapshot.expansion!.roads = packed(
      ...Array.from({ length: 6144 }, (_, i) => i),
    );
    layer.update(snapshot);
    draw(1);
    expect(contexts).toHaveLength(0);
    layer.draw(screen, 8, 0, 0, 100, 100);
    expect(contexts).toHaveLength(1);
    for (const scale of [2, 4, 8, 16, 32, 64, 128]) draw(scale);
    expect((layer as unknown as { pixels: number }).pixels).toBeLessThanOrEqual(
      12_000_000,
    );
    expect(snapshot.expansion!.roads.length / 3).toBe(
      map.width() * map.height(),
    );
  });
});
