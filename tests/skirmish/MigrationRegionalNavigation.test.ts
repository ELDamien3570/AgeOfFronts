import { expect, it } from "vitest";
import { generateMigration } from "../../src/skirmish/MigrationMap";
import { WaterPaths } from "../../src/skirmish/Pathfinding";
import { SpawnSelection } from "../../src/skirmish/domain/SpawnSelection";
import { mapIdentity } from "../../src/skirmish/multiplayer/application/MapIdentity";

it("regional landforms preserve connected water and viable starts on islands and mainlands", () => {
  for (const size of [250, 500, 1000])
    for (const seed of [0, 3, 42]) {
      const loaded = generateMigration(size, seed),
        sea = new WaterPaths(loaded.map, false),
        components = new Set<number>(),
        selection = new SpawnSelection(loaded.map, {
          seed,
          aiCount: 3,
          tribes: true,
          tribeCount: 20,
          ruleset: "ages-v1",
        });
      for (let tile = 0; tile < loaded.terrain.length; tile++)
        if (loaded.map.isWater(tile)) components.add(sea.component[tile]);
      expect(components.size).toBe(1);
      for (const mass of [
        ...loaded.layout.mainlands,
        ...loaded.layout.islands.filter(
          (i) => Math.min(i.radiusX, i.radiusY) >= 16,
        ),
      ])
        expect(
          selection.candidates.some(
            (tile) => loaded.layout.regions[tile] === mass.id,
          ),
        ).toBe(true);
      const starts = selection.resolve();
      expect(starts).toHaveLength(24);
      expect(new Set(starts).size).toBe(24);
    }
}, 60000);
it("retains the medium-map maximum roster", () => {
  for (const seed of [0, 3, 42]) {
    const map = generateMigration(500, seed).map,
      starts = new SpawnSelection(map, {
        seed,
        aiCount: 14,
        tribes: true,
        tribeCount: 30,
        ruleset: "ages-v1",
        humanNames: Array.from({ length: 20 }, (_, i) => `H${i}`),
      }).resolve();
    expect(starts).toHaveLength(64);
    expect(new Set(starts).size).toBe(64);
  }
}, 30000);
it("regional generation remains canonical and deterministic", async () => {
  const a = generateMigration(250, 3),
    b = generateMigration(250, 3),
    c = generateMigration(250, 4),
    identity = (loaded: ReturnType<typeof generateMigration>) =>
      mapIdentity({
        width: 250,
        height: 250,
        terrain: loaded.terrain,
        elevation: loaded.elevation,
        forest: loaded.forest,
        resourceTerrain: loaded.resourceTerrain,
      });
  expect(await identity(a)).toBe(await identity(b));
  expect(await identity(a)).not.toBe(await identity(c));
  expect(a.layout.landforms).toEqual(b.layout.landforms);
});
it("keeps the supported small-map boundary rosters viable", () => {
  const maps = Array.from({ length: 12 }, (_, seed) => generateMigration(250, seed).map);
  for (const [regular, tribes] of [
    [20, 27],
    [24, 20],
    [28, 13],
    [32, 6],
    [34, 3],
  ])
    for (let seed = 0; seed < 12; seed++) {
      const map = maps[seed],
        starts = new SpawnSelection(map, {
          seed,
          aiCount: regular - 20,
          tribes: true,
          tribeCount: tribes,
          ruleset: "ages-v1",
          humanNames: Array.from({ length: 20 }, (_, i) => `H${i}`),
        }).resolve();
      expect(starts).toHaveLength(regular + tribes);
      expect(new Set(starts).size).toBe(regular + tribes);
    }
}, 60000);
