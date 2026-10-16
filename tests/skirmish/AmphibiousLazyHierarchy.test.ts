import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { ARMY_TECHNOLOGY } from "../../src/skirmish/content/Armies";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { forestOf } from "../../src/skirmish/Forest";
import { AmphibiousPaths, LandPaths } from "../../src/skirmish/Pathfinding";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { retainSquads } from "./UnitFixtures";

const WIDTH = 200, HEIGHT = 100;
const water = (x: number, y: number) => x >= 90 && x < 104 && y > 4;

describe("lazy amphibious hierarchy (R2-P25)", () => {
  it("builds on the first long search and returns the eager hierarchy's routes, after forest changes", () => {
    const terrain = new Uint8Array(WIDTH * HEIGHT).fill(133);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) if (water(x, y)) terrain[y * WIDTH + x] = 0;
    const cover = new Uint8Array(WIDTH * HEIGHT);
    for (let i = 0; i < cover.length; i += 7) if (terrain[i]) cover[i] = 255;
    const map = createSkirmishMap(WIDTH, HEIGHT, terrain, undefined, { cover });
    const lazy = new AmphibiousPaths(map, false), eager = new LandPaths(map, false, "amphibious");
    expect(lazy.residency.hierarchyBuilt).toBe(false);
    expect(eager.residency.hierarchyBuilt).toBe(true);
    // Terrain costs change before the lazy hierarchy exists.
    const forest = forestOf(map)!;
    for (let x = 10; x < 180; x += 9) forest.occupy(map, map.ref(x, 50), "city");
    // A short search stays exact and does not build the hierarchy.
    expect(lazy.find(map.ref(5, 5), map.ref(20, 20))).toEqual(eager.find(map.ref(5, 5), map.ref(20, 20)));
    expect(lazy.hierarchyBuilt).toBe(false);
    for (let i = 0; i < 24; i++) {
      const start = map.ref(3 + (i * 7) % 60, 3 + (i * 13) % 94), goal = map.ref(120 + (i * 11) % 75, 3 + (i * 17) % 94);
      expect(lazy.find(start, goal)).toEqual(eager.find(start, goal));
    }
    expect(lazy.hierarchyBuilt).toBe(true);
    expect(lazy.residency.hierarchy.portals).toBe(eager.residency.hierarchy.portals);
    expect(lazy.work).toBe(eager.work);
  });
});

function amphibiousMatch(deferredPlanning = true) {
  const terrain = new Uint8Array(WIDTH * HEIGHT).fill(133);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) if (water(x, y)) terrain[y * WIDTH + x] = 0;
  const map = new GameMapImpl(WIDTH, HEIGHT, terrain, terrain.filter(v => v & 128).length);
  const match = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning });
  const template = match.squads.find(s => s.playerId === 1)!;
  const squads = retainSquads(match, [...match.squads.filter(s => s.playerId !== 1), ...Array.from({ length: 4 }, (_, i) => ({
    ...template, id: match.allocateId(), x: Math.round((30.5 + (i % 2) * 1.5) * FIXED), y: Math.round((40.5 + Math.floor(i / 2) * 1.5) * FIXED),
    order: { type: "hold" as const }, path: [], queuedOrders: [],
  }))]).filter(s => s.playerId === 1);
  match.expansion!.progression.states[1].completed.push(ARMY_TECHNOLOGY);
  expect(match.amphibious(1)).toBe(true);
  return { map, match, squads };
}
const squadDigest = (match: Skirmish) => createHash("sha256").update(JSON.stringify([...match.squads]
  .sort((a, b) => a.id - b.id).map((s: Squad) => [s.id, s.x, s.y, s.order, s.path, s.nextPathIndex, s.afloat ?? null]))).digest("hex");
function marchAcross(f: ReturnType<typeof amphibiousMatch>) {
  expect(f.match.applyCommand({ type: "create-army", playerId: 1, squadIds: f.squads.map(s => s.id) })).toBeNull();
  const army = f.match.expansion!.armies.armyOf(f.squads[0].id)!;
  // Legs well over 48 tiles, across the water.
  expect(f.match.applyCommand({ type: "army-order", playerId: 1, armyId: army.id, order: { type: "move", tile: f.map.ref(170, 45) } })).toBeNull();
}

describe("lazy amphibious hierarchy in a match (R2-P25)", () => {
  it("routes an amphibious army identically to an eagerly built hierarchy", () => {
    // Synchronous (legacy) routing runs long amphibious searches, so the
    // lazy hierarchy is built and used here.
    const lazy = amphibiousMatch(false), eager = amphibiousMatch(false);
    // Reading the portal count builds the hierarchy up front: the eager control.
    expect(eager.match.amphibiousPaths!.hierarchyPortals).toBeGreaterThan(0);
    expect(lazy.match.amphibiousPaths!.residency.hierarchyBuilt).toBe(false);
    for (let i = 0; i < 20; i++) { lazy.match.step(); eager.match.step(); }
    expect(lazy.match.amphibiousPaths!.residency.hierarchyBuilt).toBe(false);
    marchAcross(lazy); marchAcross(eager);
    for (let tick = 1; tick <= 1200; tick++) {
      lazy.match.step(); eager.match.step();
      if (tick % 400 === 0) expect(squadDigest(lazy.match)).toBe(squadDigest(eager.match));
    }
    expect(lazy.match.amphibiousPaths!.residency.hierarchyBuilt).toBe(true);
    expect(lazy.squads.some(s => lazy.match.squad(s.id)!.x > 40 * FIXED)).toBe(true);
  }, 120_000);

  it("is never built by deferred planning, which answers crossings with bounded exact search", () => {
    const lazy = amphibiousMatch(), eager = amphibiousMatch();
    expect(eager.match.amphibiousPaths!.hierarchyPortals).toBeGreaterThan(0);
    marchAcross(lazy); marchAcross(eager);
    for (let tick = 1; tick <= 800; tick++) {
      lazy.match.step(); eager.match.step();
      if (tick % 400 === 0) expect(squadDigest(lazy.match)).toBe(squadDigest(eager.match));
    }
    expect(lazy.match.amphibiousPaths!.residency.hierarchyBuilt).toBe(false);
    expect(lazy.match.amphibiousPaths!.residency.hierarchy.treeBytes).toBe(0);
    expect(lazy.squads.every(s => lazy.match.squad(s.id)!.x > 110 * FIXED)).toBe(true);
  }, 120_000);

  it("restores a checkpoint taken before the hierarchy was built and continues identically", () => {
    const a = amphibiousMatch(false);
    a.match.step();
    const saved = a.match.checkpoint();
    expect(saved.planning.sharedPreparation?.amphibious).toBeUndefined();
    const b = amphibiousMatch(false);
    b.match.restore(saved);
    expect(b.match.amphibiousPaths!.residency.hierarchyBuilt).toBe(false);
    marchAcross(a); marchAcross(b);
    for (let tick = 0; tick < 400; tick++) { a.match.step(); b.match.step(); }
    expect(squadDigest(b.match)).toBe(squadDigest(a.match));
    expect(a.match.amphibiousPaths!.hierarchyBuilt).toBe(true);
    expect(b.match.amphibiousPaths!.hierarchyBuilt).toBe(true);
    // And a built hierarchy's checkpoint restores into a fresh match.
    const c = amphibiousMatch(false);
    c.match.restore(a.match.checkpoint());
    for (let tick = 0; tick < 100; tick++) { a.match.step(); c.match.step(); }
    expect(squadDigest(c.match)).toBe(squadDigest(a.match));
  }, 120_000);
});
