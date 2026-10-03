import { retainSquads } from "./UnitFixtures";
import { describe, expect, it, vi } from "vitest";
import type { GameMap } from "../../src/core/game/GameMap";
import {
  TerrainDecorations,
  overlaps,
} from "../../src/skirmish/client/TerrainDecorations";
import { TerrainEnvironment } from "../../src/skirmish/client/TerrainEnvironment";
import { TerrainViewModel } from "../../src/skirmish/client/TerrainViewModel";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { EnvironmentProfile } from "../../src/skirmish/Environment";
import { forestOf } from "../../src/skirmish/Forest";
import { generateForestCover } from "../../src/skirmish/ForestGeneration";
import { LandPaths } from "../../src/skirmish/Pathfinding";
import { PathTopology } from "../../src/skirmish/PathTopology";
import { FIXED } from "../../src/skirmish/Protocol";
import { SQUAD_RULES } from "../../src/skirmish/Rules";
import { Skirmish } from "../../src/skirmish/Simulation";
import { terrainSpeed } from "../../src/skirmish/Terrain";

function fixture(
  width = 80,
  height = 40,
  cover = new Uint8Array(width * height).fill(255),
) {
  return createSkirmishMap(
    width,
    height,
    new Uint8Array(width * height).fill(133),
    undefined,
    { cover },
  );
}
function cost(map: GameMap, route: number[]) {
  const topology = new PathTopology(map, false);
  return route
    .slice(1)
    .reduce((sum, tile, index) => sum + topology.cost(route[index], tile), 0);
}

describe("shared forest ground", () => {
  it("preserves cover across worker reconstruction, without mutating source bytes or DTOs", () => {
    const cover = new Uint8Array([0, 128, 255]),
      terrain = new Uint8Array([133, 133, 133]);
    const map = createSkirmishMap(3, 1, terrain, undefined, { cover }),
      worker = createSkirmishMap(
        3,
        1,
        terrain.slice(),
        undefined,
        structuredClone({ cover }),
      );
    expect([0, 1, 2].map((tile) => terrainSpeed(map, tile))).toEqual([
      56, 45, 34,
    ]);
    expect([0, 1, 2].map((tile) => terrainSpeed(worker, tile))).toEqual([
      56, 45, 34,
    ]);
    forestOf(map)!.occupy(map, 2, "city");
    expect(terrainSpeed(map, 2)).toBe(56);
    expect(terrainSpeed(worker, 2)).toBe(34);
    expect(cover).toEqual(new Uint8Array([0, 128, 255]));
    expect(terrain).toEqual(new Uint8Array([133, 133, 133]));
    expect(() =>
      createSkirmishMap(3, 1, terrain, undefined, { cover: new Uint8Array(2) }),
    ).toThrow(/forest/);
    expect(() =>
      createSkirmishMap(1, 1, new Uint8Array([0]), undefined, {
        cover: new Uint8Array([255]),
      }),
    ).toThrow(/passable land/);
    expect(new TerrainViewModel(worker).describe(2)).toContain(
      "Forest 100% cover (−40%)",
    );
    expect(new TerrainViewModel(map).describe(2)).not.toContain("Forest");
  });

  it("applies density-scaled movement to infantry, archers and cavalry in the simulation", () => {
    for (const kind of ["infantry", "archer", "cavalry"] as const) {
      const map = fixture(),
        match = new Skirmish(map, { seed: 42, aiCount: 1, runAi: false });
      const squad = match.squads[0];
      retainSquads(match, [squad]);
      match.updateSquad(squad.id, { kind: kind });
      match.updateSquad(squad.id, { x: 40 * FIXED + FIXED / 2 });
      match.updateSquad(squad.id, { y: 20 * FIXED + FIXED / 2 });
      const start = squad.x;
      expect(
        match.applyCommand({
          type: "order",
          playerId: 1,
          squadIds: [squad.id],
          order: { type: "move", tile: map.ref(60, 20) },
        }),
      ).toBeNull();
      match.step();
      expect(
        Math.hypot(squad.x - start, squad.y - (20 * FIXED + FIXED / 2)),
      ).toBeCloseTo(Math.floor((34 * SQUAD_RULES[kind].speedPercent) / 100), 0);
    }
  });

  it("clears construction immediately and counts a stack as one ground site", () => {
    const map = fixture(),
      match = new Skirmish(map, { seed: 42, aiCount: 1, runAi: false }),
      player = match.players[0],
      forest = forestOf(map)!;
    expect(forest.coverAt(player.base)).toBe(0); // starting barracks
    const tile = map.ref(map.x(player.base) + 3, map.y(player.base));
    expect(match.owners[tile]).toBe(1);
    expect(forest.coverAt(tile)).toBe(1);
    player.gold = 10000;
    expect(
      match.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "city",
        tile,
      }),
    ).toBeNull();
    expect(forest.coverAt(tile)).toBe(0);
    expect(
      match.buildings[match.buildings.length - 1].remainingTicks,
    ).toBeGreaterThan(0);
    const changed = vi.fn();
    forest.onChange(changed);
    expect(
      match.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "city",
        tile,
      }),
    ).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    forest.updateBuildings(map, [
      { tile, type: "city" },
      { tile: tile + 1, type: "city" },
    ]);
    forest.updateBuildings(map, [{ tile: tile + 1, type: "city" }]);
    expect(forest.coverAt(tile)).toBe(0);
    forest.updateBuildings(map, []);
    expect(forest.coverAt(tile)).toBe(1);
  });

  it("chooses a useful opening and updates exact routes when buildings clear a corridor", () => {
    const cover = new Uint8Array(80 * 40);
    for (let y = 15; y <= 25; y++)
      for (let x = 25; x <= 55; x++) cover[y * 80 + x] = 255;
    const map = fixture(80, 40, cover),
      paths = new LandPaths(map),
      start = map.ref(10, 20),
      goal = map.ref(70, 20);
    const before = paths.find(start, goal)!;
    expect(before.some((tile) => map.y(tile) < 15 || map.y(tile) > 25)).toBe(
      true,
    );
    forestOf(map)!.updateBuildings(
      map,
      Array.from({ length: 17 }, (_, i) => ({
        tile: map.ref(24 + i * 2, 20),
        type: "city" as const,
      })),
    );
    const after = paths.find(start, goal)!;
    expect(after.every((tile) => map.y(tile) === 20)).toBe(true);
    expect(cost(map, [start, ...after])).toBe(600);
  });

  it("refreshes warmed HPA crossings after construction without changing connectivity", () => {
    const cover = new Uint8Array(320 * 256);
    for (let y = 72; y <= 88; y++)
      for (let x = 64; x <= 255; x++) cover[y * 320 + x] = 255;
    const map = fixture(320, 256, cover),
      paths = new LandPaths(map),
      start = map.ref(10, 80),
      goal = map.ref(300, 80);
    const before = paths.find(start, goal)!,
      beforeCost = cost(map, [start, ...before]);
    forestOf(map)!.updateBuildings(
      map,
      Array.from({ length: 99 }, (_, i) => ({
        tile: map.ref(62 + i * 2, 80),
        type: "city" as const,
      })),
    );
    const after = paths.find(start, goal)!,
      fresh = new LandPaths(map).find(start, goal)!;
    expect(cost(map, [start, ...after])).toBe(cost(map, [start, ...fresh]));
    expect(cost(map, [start, ...after])).toBeLessThan(beforeCost);
    expect(paths.connected(start, goal)).toBe(true);
    for (let i = 1; i < after.length; i++)
      expect(
        Math.max(
          Math.abs(map.x(after[i]) - map.x(after[i - 1])),
          Math.abs(map.y(after[i]) - map.y(after[i - 1])),
        ),
      ).toBe(1);
  });
});

describe("coherent woodland generation", () => {
  it("creates repeatable connected stands and open clearings, with smooth edges", () => {
    const map = createSkirmishMap(
        500,
        250,
        new Uint8Array(500 * 250).fill(133),
      ),
      environment = new EnvironmentProfile(map),
      data = generateForestCover(map, environment);
    expect(data.cover).toEqual(generateForestCover(map, environment).cover);
    const values = Array.from(data.cover);
    expect(values.filter((value) => value > 190).length).toBeGreaterThan(2000);
    expect(values.filter((value) => value === 0).length).toBeGreaterThan(2000);
    let difference = 0,
      pairs = 0;
    for (let y = 0; y < 250; y++)
      for (let x = 0; x < 499; x++) {
        const tile = map.ref(x, y);
        if (environment.familyAt(tile) !== environment.familyAt(tile + 1))
          continue;
        difference += Math.abs(data.cover[tile] - data.cover[tile + 1]) / 255;
        pairs++;
      }
    expect(difference / pairs).toBeLessThan(0.08);
    // At least one stand must occupy a substantial continuous area, rather
    // than merely satisfying a high global count with isolated random stamps.
    const seen = new Uint8Array(values.length);
    let largest = 0;
    for (let tile = 0; tile < values.length; tile++) {
      if (seen[tile] || values[tile] < 160) continue;
      const queue = [tile];
      seen[tile] = 1;
      for (let i = 0; i < queue.length; i++)
        for (const next of map.neighbors(queue[i]))
          if (!seen[next] && values[next] >= 160) {
            seen[next] = 1;
            queue.push(next);
          }
      largest = Math.max(largest, queue.length);
    }
    expect(largest).toBeGreaterThan(500);
    const forested = createSkirmishMap(
        500,
        250,
        new Uint8Array(values.length).fill(133),
        undefined,
        data,
      ),
      decorations = new TerrainDecorations(
        forested,
        new TerrainEnvironment(forested, undefined, environment),
      ),
      accents = Array.from(
        decorations.visible({ left: 0, top: 0, right: 500, bottom: 250 }),
      ),
      canopies = accents.filter((accent) => accent.accent.role === "canopy");
    expect(canopies.length).toBeGreaterThan(5000);
    const widths = canopies.map((tree) =>
      Math.max(
        tree.bounds.right - tree.bounds.left,
        tree.bounds.bottom - tree.bounds.top,
      ),
    );
    expect(Math.max(...widths)).toBeLessThanOrEqual(2.100001);
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(0.15);
    const tree = canopies.find(
      (accent) =>
        forestOf(forested)!.coverAt(
          forested.ref(Math.floor(accent.x), Math.floor(accent.y)),
        ) > 0.8,
    )!;
    expect(tree).toBeDefined();
    expect(
      canopies.some(
        (other) => other.id !== tree.id && overlaps(tree.bounds, other.bounds),
      ),
    ).toBe(true);
    expect(
      canopies.every(
        (accent) =>
          data.cover[forested.ref(Math.floor(accent.x), Math.floor(accent.y))] >
          0,
      ),
    ).toBe(true);
  });
});
