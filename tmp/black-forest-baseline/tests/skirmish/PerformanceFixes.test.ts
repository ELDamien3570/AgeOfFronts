import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { CoastIndex } from "../../src/skirmish/CoastIndex";
import { Diplomacy } from "../../src/skirmish/domain/Diplomacy";
import { Fortifications } from "../../src/skirmish/domain/Fortifications";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { forestOf } from "../../src/skirmish/Forest";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { FIXED, type Building } from "../../src/skirmish/Protocol";
import { RouteWork } from "../../src/skirmish/RouteWork";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SpatialGrid } from "../../src/skirmish/SpatialGrid";

// Deterministic pseudo-random sequence for fixtures; tests never use Math.random.
function sequence(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("SpatialGrid rebuild", () => {
  type Point = { x: number; y: number; id: number };
  const queryIds = (grid: SpatialGrid<Point>) => {
    const out: Point[] = [];
    grid.query(50, 50, 10_000, out);
    return out.map((p) => p.id).sort((a, b) => a - b);
  };

  it("clears items inserted before the first rebuild, then only occupied buckets", () => {
    const grid = new SpatialGrid<Point>(1000, 1000, 10);
    grid.insert({ x: 5, y: 5, id: 1 });
    grid.rebuild([{ x: 600, y: 600, id: 2 }]);
    expect(queryIds(grid)).toEqual([2]);
    grid.rebuild([
      { x: 5, y: 5, id: 3 },
      { x: 5, y: 5, id: 4 },
      { x: 900, y: 10, id: 5 },
    ]);
    expect(queryIds(grid)).toEqual([3, 4, 5]);
    grid.rebuild([]);
    expect(queryIds(grid)).toEqual([]);
  });

  it("matches a fresh grid after many rebuilds, inserts and removals", () => {
    const next = sequence(7);
    const reused = new SpatialGrid<Point>(1000, 1000, 10);
    for (let round = 0; round < 40; round++) {
      const items = Array.from({ length: 30 }, (_, id) => ({
        x: Math.floor(next() * 1000),
        y: Math.floor(next() * 1000),
        id,
      }));
      reused.rebuild(items);
      const extra = { x: 40, y: 40, id: 999 };
      reused.insert(extra);
      reused.remove(items[3]);
      const fresh = new SpatialGrid<Point>(1000, 1000, 10);
      fresh.rebuild(items);
      fresh.insert(extra);
      fresh.remove(items[3]);
      expect(queryIds(reused)).toEqual(queryIds(fresh));
    }
  });
});

describe("route cache and start-tree cache", () => {
  const width = 200,
    height = 100;
  const cover = new Uint8Array(width * height);
  const next = sequence(11);
  for (let i = 0; i < cover.length; i++) cover[i] = next() > 0.55 ? 255 : 0;
  const make = () =>
    createSkirmishMap(
      width,
      height,
      new Uint8Array(width * height).fill(133),
      undefined,
      { cover: cover.slice() },
    );

  it("returns independent copies of cached routes", () => {
    const map = make();
    const paths = new LandPaths(map);
    const a = map.ref(5, 5),
      b = map.ref(190, 90);
    const first = paths.find(a, b)!;
    const second = paths.find(a, b)!;
    expect(second).toEqual(first);
    second.length = 0;
    expect(paths.find(a, b)).toEqual(first);
  });

  it("recomputes after forest costs change and agrees with a fresh search", () => {
    const map = make();
    const paths = new LandPaths(map);
    const pairs: [number, number][] = [
      [map.ref(3, 4), map.ref(180, 80)],
      [map.ref(20, 90), map.ref(170, 8)],
      [map.ref(60, 50), map.ref(140, 52)],
    ];
    for (const [a, b] of pairs) paths.find(a, b);
    const effort = paths.work;
    // A building clears the forest around it, changing traversal costs.
    forestOf(map)!.updateBuildings(map, [
      { tile: map.ref(100, 50), type: "city" },
      { tile: map.ref(40, 45), type: "city" },
    ]);
    const fresh = new LandPaths(map);
    for (const [a, b] of pairs)
      expect(paths.find(a, b)).toEqual(fresh.find(a, b));
    expect(paths.work).toBeGreaterThan(effort);
  });

  it("counts the same effort for a cached route as for the first search", () => {
    const map = make();
    const paths = new LandPaths(map);
    const a = map.ref(3, 4),
      b = map.ref(180, 80);
    const before = paths.work;
    paths.find(a, b);
    const cost = paths.work - before;
    expect(cost).toBeGreaterThan(0);
    const mid = paths.work;
    paths.find(a, b);
    expect(paths.work - mid).toBe(cost);
  });
});

describe("coast index", () => {
  it("lists a sea's coast edges in land-tile then neighbour order", () => {
    const width = 96,
      height = 64;
    const data = new Uint8Array(width * height).fill(133);
    for (const x of [30, 62])
      for (let y = 0; y < height; y++)
        for (let dx = 0; dx < 3; dx++) data[y * width + x + dx] = 0;
    const map = new GameMapImpl(
      width,
      height,
      data,
      data.filter((t) => t & 128).length,
    );
    const land = new LandPaths(map),
      water = new WaterPaths(map);
    const coast = new CoastIndex(map, land, water);
    for (const sea of new Set(water.component.filter((c) => c > 0))) {
      const expected: { landTile: number; waterTile: number }[] = [];
      for (let tile = 0; tile < width * height; tile++) {
        if (!land.walkable(tile)) continue;
        for (const neighbour of map.neighbors(tile))
          if (water.walkable(neighbour) && water.component[neighbour] === sea)
            expected.push({ landTile: tile, waterTile: neighbour });
      }
      expect(coast.waterEdges(sea)).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
    }
  });
});

describe("fortification occupancy early-out", () => {
  it("agrees with exhaustive segment testing for random segments", () => {
    const width = 80,
      height = 60;
    const map = new GameMapImpl(
      width,
      height,
      new Uint8Array(width * height).fill(133),
      width * height,
    );
    const forts = new Fortifications(map, {
      allied: () => false,
    } as unknown as Diplomacy);
    const towers = [
      [10, 10],
      [41, 30],
      [70, 55],
      [8, 48],
    ].map(
      ([x, y], id) =>
        ({
          id: id + 1,
          type: "tower",
          tile: map.ref(x, y),
          playerId: 1,
          health: 100,
          remainingTicks: 0,
        }) as unknown as Building,
    );
    forts.step(1, towers);
    expect(forts.hasObstacles).toBe(true);
    const next = sequence(3);
    let blockedSegments = 0;
    for (let i = 0; i < 4000; i++) {
      const from = {
        x: Math.floor((next() * width - 2) * FIXED),
        y: Math.floor((next() * height - 2) * FIXED),
      };
      const reach = i % 3 === 0 ? 40 : 4;
      const to = {
        x: from.x + Math.floor((next() - 0.5) * reach * FIXED),
        y: from.y + Math.floor((next() - 0.5) * reach * FIXED),
      };
      const exhaustive = !forts
        .segmentTiles(from, to)
        .some((tile) => forts.blocked(tile, 2));
      if (!exhaustive) blockedSegments++;
      expect(forts.clear(from, to, 2)).toBe(exhaustive);
    }
    expect(blockedSegments).toBeGreaterThan(0);
  });
});

describe("route work effort budget", () => {
  it("stops after the effort limit but always runs one job, keeping FIFO order", () => {
    let spent = 0;
    const ran: string[] = [];
    const work = new RouteWork<string>((task) => {
      ran.push(task);
      spent += 100;
    });
    for (const task of ["a", "b", "c", "d", "e"]) work.request(task, 1, task);
    work.drain(24, { read: () => spent, limit: 250 });
    expect(ran).toEqual(["a", "b", "c"]);
    work.drain(24, { read: () => spent, limit: 0 });
    expect(ran).toEqual(["a", "b", "c", "d"]);
    work.drain(24);
    expect(ran).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("derived ownership sets", () => {
  const options = {
    seed: 21,
    aiCount: 5,
    tribes: false,
    ruleset: "ages-v1" as const,
  };
  const build = () => {
    const width = 192,
      height = 128;
    const next = sequence(5);
    const cover = new Uint8Array(width * height);
    for (let i = 0; i < cover.length; i++) cover[i] = next() > 0.6 ? 255 : 0;
    return createSkirmishMap(
      width,
      height,
      new Uint8Array(width * height).fill(133),
      undefined,
      { cover },
    );
  };

  it("nearest owned land equals sorting every owned tile", () => {
    const match = new Skirmish(build(), options);
    for (let tick = 0; tick < 200; tick++) match.step();
    for (const player of match.players) {
      const everything = [...match.ownedLand(player.id)].sort(
        (a, b) =>
          match.map.euclideanDistSquared(a, player.base) -
            match.map.euclideanDistSquared(b, player.base) || a - b,
      );
      expect(match.ownedLandNearest(player.id, player.base, 256)).toEqual(
        everything.slice(0, 256),
      );
      expect(match.ownedLandNearest(player.id, player.base, 7)).toEqual(
        everything.slice(0, 7),
      );
    }
  });

  it("restores ownership sets and continues identically with cold route caches", () => {
    const original = new Skirmish(build(), options);
    for (let tick = 0; tick < 150; tick++) original.step();
    const saved = original.checkpoint();
    expect(saved).not.toHaveProperty("ownedTiles");
    expect(saved).not.toHaveProperty("pressure");
    const restored = new Skirmish(build(), options);
    restored.restore(saved);
    for (const player of original.players)
      expect([...restored.ownedLand(player.id)].sort((a, b) => a - b)).toEqual(
        [...original.ownedLand(player.id)].sort((a, b) => a - b),
      );
    for (let tick = 0; tick < 450; tick++) {
      original.step();
      restored.step();
      if (tick % 50 === 0)
        expect(restored.checkpoint()).toEqual(original.checkpoint());
    }
    expect(restored.checkpoint()).toEqual(original.checkpoint());
  }, 60_000);
});

describe("component reachability matches route search", () => {
  it("finds a route for every sampled pair that shares a component", () => {
    const width = 160,
      height = 120;
    const next = sequence(99);
    const data = new Uint8Array(width * height).fill(133);
    // Scatter water blobs so the land splits into narrow passages and pockets.
    for (let blob = 0; blob < 90; blob++) {
      const cx = Math.floor(next() * width),
        cy = Math.floor(next() * height),
        radius = 3 + Math.floor(next() * 7);
      for (
        let y = Math.max(0, cy - radius);
        y < Math.min(height, cy + radius);
        y++
      )
        for (
          let x = Math.max(0, cx - radius);
          x < Math.min(width, cx + radius);
          x++
        )
          if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius)
            data[y * width + x] = 0;
    }
    const map = new GameMapImpl(
      width,
      height,
      data,
      data.filter((t) => t & 128).length,
    );
    const land = new LandPaths(map);
    const tiles: number[] = [];
    for (let tile = 0; tile < width * height; tile++)
      if (land.walkable(tile)) tiles.push(tile);
    let connectedPairs = 0;
    for (let i = 0; i < 600; i++) {
      const a = tiles[Math.floor(next() * tiles.length)],
        b = tiles[Math.floor(next() * tiles.length)];
      if (!land.connected(a, b)) {
        expect(land.find(a, b)).toBeNull();
        continue;
      }
      connectedPairs++;
      const route = land.find(a, b);
      expect(route).not.toBeNull();
      expect(a === b ? [] : route!.slice(-1)).toEqual(a === b ? [] : [b]);
    }
    expect(connectedPairs).toBeGreaterThan(100);
  });
});
