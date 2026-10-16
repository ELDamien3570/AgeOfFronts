import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { forestOf } from "../../src/skirmish/Forest";
import { HierarchicalPaths } from "../../src/skirmish/HierarchicalPaths";
import { PathTopology } from "../../src/skirmish/PathTopology";
import { Skirmish } from "../../src/skirmish/Simulation";

/** In-place restores must not keep caches keyed on state the restore replaced.
 * Rollback restores into a fresh instance; these are hardening for any
 * in-place restore (dev diagnostic replay). */
describe("restore clears derived caches", () => {
  it("drops start trees cached on an abandoned branch (R2-L15)", () => {
    const W = 128, H = 96;
    const world = () => {
      const map = createSkirmishMap(W, H, new Uint8Array(W * H).fill(133), undefined, { cover: new Uint8Array(W * H).fill(255) });
      const topo = new PathTopology(map, false), paths = new HierarchicalPaths(topo);
      paths.prepare();
      return { map, topo, paths, forest: forestOf(map)! };
    };
    const cleared = (rows: number[]) => {
      const a = new Uint16Array(W * H);
      for (const y of rows) for (let x = 0; x < 32; x++) a[y * W + x] = 1;
      return { cleared: a, sites: new Map() };
    };
    const cost = (topo: PathTopology, start: number, path: number[]) => {
      let total = 0, previous = start;
      for (const tile of path) { total += topo.cost(previous, tile); previous = tile; }
      return total;
    };
    const used = world(), start = used.map.ref(2, 16), goal = used.map.ref(29, 16);
    const forestSave = used.forest.checkpoint(), sharedSave = used.paths.sharedCheckpoint();
    // The abandoned branch clears rows 10-12 and plans through them.
    used.forest.restore(cleared([10, 11, 12]));
    used.paths.find(start, goal);
    // Roll back in place (Skirmish.restore order: forest, then shared planning), then take another branch.
    used.forest.restore(forestSave); used.paths.restoreShared(sharedSave);
    used.forest.restore(cleared([20, 21, 22]));
    const usedPath = used.paths.find(start, goal)!;
    const fresh = world();
    fresh.forest.restore(forestSave); fresh.paths.restoreShared(sharedSave);
    fresh.forest.restore(cleared([20, 21, 22]));
    const freshPath = fresh.paths.find(start, goal)!;
    expect(cost(used.topo, start, usedPath)).toBe(cost(fresh.topo, start, freshPath));
    expect(usedPath).toEqual(freshPath);
  });
  it("recomputes amphibious factions after an in-place restore with an equal-size research set (L18)", () => {
    const terrain = new Uint8Array(96 * 64).fill(133), map = new GameMapImpl(96, 64, terrain, terrain.length);
    const options = { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" as const };
    const game = new Skirmish(map, options);
    const states = game.expansion!.progression.states;
    const amphibious = (g: Skirmish) => g.transportVessel(1);
    states[1].completed = ["rus-stoneage-cargo-canoes"];
    const withTransport = amphibious(game);
    const saved = game.checkpoint();
    saved.expansion!.progression.states[1].completed = ["rus-stoneage-cities"];
    game.restore(saved);
    const fresh = new Skirmish(map, options);
    fresh.restore(saved);
    expect(amphibious(game)).toEqual(amphibious(fresh));
    expect(amphibious(game)).not.toEqual(withTransport);
  });
});
