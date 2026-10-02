import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AiBoundaryIndex } from "../../src/skirmish/domain/AiBoundaryIndex";

function fixture() {
  const data = new Uint8Array(32 * 24).fill(133);
  for (let y = 0; y < 24; y++) data[y * 32 + 15] = 0;
  const map = new GameMapImpl(32, 24, data, 31 * 24),
    owners = new Uint8Array(data.length),
    index = new AiBoundaryIndex(map, owners, (tile) => map.isLand(tile));
  const changed = (tile: number, owner: number, tick = 0) => {
    const old = owners[tile];
    owners[tile] = owner;
    index.changed(tile, old, tick);
    expect(index.diagnostics.cells).toBeLessThanOrEqual(5);
    expect(index.diagnostics.edges).toBeLessThanOrEqual(20);
  };
  const actual = (hostile = (a: number, b: number) => a !== b) => {
    const edges: string[] = [];
    for (let owner = 1; owner <= 3; owner++)
      for (const chunk of index.chunks(owner))
        for (const tile of chunk.tiles)
          for (const edge of index.hostileEdges(tile, hostile))
            edges.push(`${owner}:${tile}:${edge.neighbor}`);
    return edges.sort();
  };
  const expected = (hostile = (a: number, b: number) => a !== b) => {
    const edges: string[] = [];
    for (let tile = 0; tile < owners.length; tile++)
      if (owners[tile] && map.isLand(tile))
        for (const next of map.neighbors(tile))
          if (
            map.isLand(next) &&
            owners[next] &&
            owners[tile] !== owners[next] &&
            hostile(owners[tile], owners[next])
          )
            edges.push(`${owners[tile]}:${tile}:${next}`);
    return edges.sort();
  };
  return { map, owners, index, changed, actual, expected };
}
describe("shared ownership boundary facts", () => {
  it("matches current truth through captures, loss, neutralization and map edges", () => {
    const f = fixture();
    let seed = 417;
    for (let tick = 0; tick < 500; tick++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const tile = seed % f.owners.length,
        owner = (seed >>> 12) % 4;
      f.changed(tile, owner, tick);
      if (tick % 25 === 0) expect(f.actual()).toEqual(f.expected());
    }
    expect(f.actual()).toEqual(f.expected());
    expect(f.index.diagnostics.bytes).toBe(f.owners.length);
  });
  it("filters treaties immediately without rebuilding foreign ownership geometry", () => {
    const f = fixture();
    f.changed(f.map.ref(4, 5), 1);
    f.changed(f.map.ref(5, 5), 2);
    const before = f.index.checkpoint();
    expect(f.actual()).toHaveLength(2);
    expect(f.actual(() => false)).toHaveLength(0);
    expect(f.index.checkpoint()).toEqual(before);
    expect(f.actual()).toHaveLength(2);
  });
  it("keeps revisions increasing when a chunk disappears and later returns", () => {
    const f = fixture(),
      tile = f.map.ref(4, 5),
      next = f.map.ref(5, 5);
    f.changed(tile, 1);
    f.changed(next, 2);
    const revision = [...f.index.chunks(1)][0].revision;
    f.changed(next, 0);
    expect([...f.index.chunks(1)]).toHaveLength(0);
    f.changed(next, 2);
    expect([...f.index.chunks(1)][0].revision).toBeGreaterThan(revision);
  });
  it("restores fact order and geometry without serializing the full map mask", () => {
    const f = fixture();
    for (let x = 0; x < 30; x++) {
      f.changed(f.map.ref(x, 3), 1);
      f.changed(f.map.ref(x, 4), 2);
    }
    const saved = f.index.checkpoint(),
      restored = new AiBoundaryIndex(f.map, f.owners, (t) => f.map.isLand(t));
    restored.restore(saved);
    expect(restored.checkpoint()).toEqual(saved);
    const tile = f.map.ref(4, 3),
      old = f.owners[tile];
    f.changed(tile, 3);
    restored.changed(tile, old, 0);
    expect(restored.checkpoint()).toEqual(f.index.checkpoint());
  });
  it("resumes a bounded cold rebuild and keeps live captures authoritative during it", () => {
    const f = fixture();
    f.owners.fill(1);
    for (let y = 0; y < 24; y++)
      for (let x = 20; x < 32; x++) f.owners[f.map.ref(x, y)] = 2;
    f.index.resetForRebuild();
    for (let tick = 0; tick < 800 && !f.index.ready; tick++) {
      expect(f.index.step(tick, 3)).toBeLessThanOrEqual(3);
      if (tick === 50) f.changed(f.map.ref(21, 5), 3, tick);
      if (tick === 75) {
        const saved = f.index.checkpoint();
        f.index.restore(saved);
        expect(f.index.checkpoint()).toEqual(saved);
      }
    }
    expect(f.index.ready).toBe(true);
    expect(f.actual()).toEqual(f.expected());
  });
});
