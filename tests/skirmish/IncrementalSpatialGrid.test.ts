import { describe, expect, it } from "vitest";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { IncrementalSpatialGrid, SpatialGrid } from "../../src/skirmish/SpatialGrid";
import { checkpointDigest, idleTickFixture, IDLE_TICK_FIXTURE_TICKS, IDLE_TICK_GOLDEN, squadDigest } from "./fixtures/IdleTickFixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Roadmap Next #2, I-3: incremental maintenance of the movement grid.
interface Item { id: number; x: number; y: number; owner: number; extent: number }
const SIZE = 64 * 256, CELL = 512;
const fresh = (items: Item[]) => {
  const g = new SpatialGrid<Item>(SIZE, SIZE, CELL, i => i.owner, i => i.extent);
  g.rebuild([...items].sort((a, b) => a.id - b.id));
  return g;
};
/** Structural state a rebuild from an id-sorted source produces. */
const state = (grid: SpatialGrid<Item>) => {
  const g = grid as any, buckets: [number, number[], number | undefined][] = [];
  g.buckets.forEach((bucket: Item[] | undefined, key: number) => {
    if (bucket?.length) buckets.push([key, bucket.map(i => i.id), g.partition ? g.partitions[key] : undefined]);
  });
  return { buckets, occupied: Array.from(g.occupied as Uint32Array), maximumExtent: g.maximumExtent };
};
const queries = (grid: SpatialGrid<Item>, random: PseudoRandom) => {
  const out: unknown[] = [], result: Item[] = [];
  for (let q = 0; q < 12; q++) {
    const x = random.nextInt(0, SIZE), y = random.nextInt(0, SIZE), r = random.nextInt(0, 4000), ex = random.nextInt(0, 5);
    grid.query(x, y, r, result, ex || undefined); out.push(result.map(i => i.id));
    grid.queryOverlaps(x, y, r, result, ex || undefined); out.push(result.map(i => i.id));
    const seen: number[] = [];
    out.push(grid.mayOverlap(x, y, r, i => { seen.push(i.id); return i.id % 7 === 0; }, ex || undefined), seen);
    out.push(grid.mayContain(x, y, r, ex || undefined));
    grid.sample(x, y, r, result, i => i.id % 2 === 0, 5, 20, q); out.push(result.map(i => i.id));
    out.push(grid.nearest(x, y, i => i.owner !== ex)?.id);
  }
  return out;
};

describe("IncrementalSpatialGrid", () => {
  it("equals a fresh id-ordered rebuild after every batch of random moves", () => {
    const random = new PseudoRandom(20261016);
    const items: Item[] = Array.from({ length: 160 }, (_, i) => ({ id: 3 + i * 2, x: random.nextInt(0, SIZE), y: random.nextInt(0, SIZE), owner: random.nextInt(1, 5), extent: random.nextInt(0, 600) }));
    const grid = new IncrementalSpatialGrid<Item>(SIZE, SIZE, CELL, i => i.owner, i => i.extent);
    grid.rebuild([...items].sort((a, b) => a.id - b.id));
    for (let step = 0; step < 120; step++) {
      const changed = new Set<Item>();
      for (let n = random.nextInt(0, 30); n > 0; n--) {
        const item = items[random.nextInt(0, items.length)];
        const kind = random.nextInt(0, 6);
        // Mostly short marches, some long jumps, owner and extent changes, and
        // pile-ups into one cell so buckets hold several owners.
        if (kind < 3) { item.x = Math.min(SIZE - 1, Math.max(0, item.x + random.nextInt(-300, 300))); item.y = Math.min(SIZE - 1, Math.max(0, item.y + random.nextInt(-300, 300))); }
        else if (kind === 3) { item.x = random.nextInt(0, SIZE); item.y = random.nextInt(0, SIZE); }
        else if (kind === 4) item.owner = random.nextInt(1, 5);
        else { item.extent = random.nextInt(0, 900); item.x = 1000 + random.nextInt(0, 100); item.y = 1000; }
        changed.add(item);
      }
      grid.update(changed);
      const reference = fresh(items);
      expect(state(grid)).toEqual(state(reference));
      expect(queries(grid, new PseudoRandom(step))).toEqual(queries(reference, new PseudoRandom(step)));
      if (step % 40 === 39) { grid.rebuild([...items].sort((a, b) => a.id - b.id)); expect(state(grid)).toEqual(state(fresh(items))); }
    }
    expect(grid.work.moves).toBeGreaterThan(100);
    // Repeated empty/refill cycles never let the clear list grow without bound.
    expect((grid as any).active.length).toBeLessThanOrEqual(2 * (grid as any).allocated.length + 1);
  });
  it("rejects updates before a rebuild and items it never indexed", () => {
    const grid = new IncrementalSpatialGrid<Item>(SIZE, SIZE, CELL);
    const item = { id: 1, x: 10, y: 10, owner: 1, extent: 0 };
    expect(() => grid.update([item])).toThrow();
    grid.rebuild([]);
    expect(() => grid.update([item])).toThrow();
    grid.insert(item);
    item.x = 5000;
    grid.update([item]);
    const out: Item[] = [];
    grid.query(5000, 10, 1, out);
    expect(out).toEqual([item]);
  });
});

describe("movement grid maintenance in the simulation (I-3)", () => {
  it("matches a fresh rebuild at every synchronisation and keeps the fixture hash", () => {
    const game = idleTickFixture(), sim = game as any, spatial = sim.spatial;
    const original = sim.movementLand.bind(sim);
    let checks = 0;
    sim.movementLand = () => {
      const before = sim.idleTickWork.movementUpdates + sim.idleTickWork.movementRebuilds;
      const land = original();
      // Between synchronisations the grid is deliberately as stale as before.
      if (sim.idleTickWork.movementUpdates + sim.idleTickWork.movementRebuilds !== before) {
        const reference = new SpatialGrid<any>(game.map.width() * 256, game.map.height() * 256, 2 * 256, spatial.partition, spatial.extent);
        reference.rebuild(land);
        expect(state(spatial)).toEqual(state(reference));
        checks++;
      }
      return land;
    };
    for (let i = 0; i < IDLE_TICK_FIXTURE_TICKS; i++) game.step();
    expect(checks).toBeGreaterThan(IDLE_TICK_FIXTURE_TICKS);
    expect(squadDigest(game.squads)).toBe(IDLE_TICK_GOLDEN.squads);
    expect(checkpointDigest(game)).toBe(IDLE_TICK_GOLDEN.checkpoint);
    const work = sim.idleTickWork;
    // Baseline (aof/next-1): 2.0 full rebuilds per tick of about 64 rows. Full
    // rebuilds now happen only when land membership changes.
    expect(work.movementUpdates).toBeGreaterThan(IDLE_TICK_FIXTURE_TICKS);
    expect(work.movementRebuilds).toBeLessThan(work.movementUpdates / 2);
    expect(work.movementUpdateRows).toBeLessThan(0.8 * (work.movementUpdates * game.squads.length));
  }, 120_000);
});
