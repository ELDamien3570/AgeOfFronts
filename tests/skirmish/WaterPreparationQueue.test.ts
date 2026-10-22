import {expect, it} from "vitest";
import {GameMapImpl} from "../../src/core/game/GameMap";
import {PathTopology} from "../../src/skirmish/PathTopology";
import {PlanningWorkspace} from "../../src/skirmish/PlanningWorkspace";
import {HierarchicalPaths} from "../../src/skirmish/HierarchicalPaths";

it("breadth-first water preparation matches heap distances through holes and narrow edge clusters", () => {
  const width = 65, height = 47, terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    if ((x * 13 + y * 7) % 19 === 0 || x === 17 && y % 11 !== 0) terrain[y * width + x] = 133;
  const map = new GameMapImpl(width, height, terrain, terrain.filter(t => t !== 0).length);
  const old = new HierarchicalPaths(new PathTopology(map, "water")) as any,
    fast = new HierarchicalPaths(new PathTopology(map, "water")) as any;
  for (const [x, y] of [[3, 3], [31, 5], [35, 38], [64, 2], [64, 46]]) {
    const origin = map.ref(x, y), cluster = fast.cluster(origin), local = {origin, cluster, progress: 0};
    const a = old.sharedLocal(local, false), b = fast.sharedLocal(local, true);
    while (a.runtime.heap) old.advanceLocal(a.runtime, cluster, 17);
    while (b.runtime.heap) fast.advanceLocal(b.runtime, cluster, 17);
    expect(b.runtime.tree.cost).toEqual(a.runtime.tree.cost);
    expect(b.runtime.tree.settled).toBe(a.runtime.tree.settled);
    const c = fast.clusters[cluster], tree = b.runtime.tree;
    for (let at = 0; at < tree.parent.length; at++) if (tree.parent[at] >= 0) {
      const parent = tree.parent[at], tile = fast.tile(c, at), from = fast.tile(c, parent);
      expect(map.manhattanDist(tile, from)).toBe(1);
      expect(map.isWater(tile)).toBe(true);
      expect(tree.cost[at]).toBe(tree.cost[parent] + 10);
    }
  }
});

it("rejects malformed FIFO checkpoint identity, duplicate frontier cells and land use", () => {
  const map = new GameMapImpl(64, 32, new Uint8Array(2048), 0), water = new HierarchicalPaths(new PathTopology(map, "water")) as any;
  const entry = water.sharedLocal({origin: 3, cluster: 0, progress: 0}, true);
  water.advanceLocal(entry.runtime, 0, 17); entry.local.progress = Math.ceil(entry.runtime.tree.effort / 512);
  const saved = water.sharedCheckpoint(); expect(saved.version).toBe(2);
  const restored = new HierarchicalPaths(new PathTopology(map, "water")); restored.restoreShared(saved);
  expect(restored.sharedCheckpoint()).toEqual(saved);
  const duplicate = structuredClone(saved); duplicate.entries[0].heap.tiles[1] = duplicate.entries[0].heap.tiles[0];
  expect(() => restored.restoreShared(duplicate)).toThrow("entry");
  const oldVersion = structuredClone(saved); oldVersion.version = 1;
  expect(() => restored.restoreShared(oldVersion)).toThrow("entry");
  const land = new HierarchicalPaths(new PathTopology(map, "land"));
  expect(() => land.restoreShared(saved)).toThrow("entry");
});


it("keeps FIFO tie parents out of the physical caches used by legacy synchronous searches", () => {
  const map = new GameMapImpl(96, 32, new Uint8Array(3072), 0),
    warm = new HierarchicalPaths(new PathTopology(map, "water")) as any,
    cold = new HierarchicalPaths(new PathTopology(map, "water")) as any,
    arena = new PlanningWorkspace(2048), start = map.ref(3, 3), goal = map.ref(90, 27),
    state = warm.begin(start, goal, 0, new Map());
  for (let n = 0; state.phase !== "done" && n < 100; n++) warm.step(state, arena, 2048, 0, undefined, 2048, {used: 0}, true, true);
  expect(state.phase).toBe("done");
  expect(warm.startTrees.size).toBe(0);
  expect(warm.portals.every((p: any) => !p.tree)).toBe(true);
  expect(warm.find(start, goal)).toEqual(cold.find(start, goal));
});
