import { describe, expect, it } from "vitest";
import { SpawnSelection } from "../../src/skirmish/domain/SpawnSelection";
import {
  defaultLobbySettings,
  validateLobbySettings,
} from "../../src/skirmish/lobby/LobbyDirectory";
import { generateMigration } from "../../src/skirmish/MigrationMap";
import { mapIdentity } from "../../src/skirmish/multiplayer/application/MapIdentity";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { Skirmish } from "../../src/skirmish/Simulation";
import { loadMap } from "../../src/skirmish/Terrain";

describe("Migration layout", () => {
  for (const size of [250, 500, 1000] as const)
    it(`${size}: deterministic solo/server map with distinct seeded coasts`, async () => {
      const a = await loadMap("migration", size, 3),
        b = await loadServerMap(
          defaultLobbySettings("migration", size),
          undefined,
          3,
        ),
        c = await loadServerMap(
          defaultLobbySettings("migration", size),
          undefined,
          4,
        );
      expect(
        await mapIdentity({
          width: size,
          height: size,
          terrain: a.terrain,
          elevation: a.elevation,
          forest: a.forest,
          resourceTerrain: a.resourceTerrain,
        }),
      ).toBe(await mapIdentity(b.map));
      expect(await mapIdentity(c.map)).not.toBe(await mapIdentity(b.map));
    }, 30000);
  it("keeps outer islands separate from a larger mainland and preserves navigable sea", () => {
    for (const size of [250, 500, 1000])
      for (const seed of [0, 3, 42]) {
        const loaded = generateMigration(size, seed),
          land = new LandPaths(loaded.map, false),
          sea = new WaterPaths(loaded.map, false),
          components = new Set<number>(),
          areas = new Map<number, number>(),
          seaComponents = new Set<number>();
        for (let tile = 0; tile < loaded.terrain.length; tile++) {
          if (loaded.map.isLand(tile)) {
            if (loaded.map.isImpassable(tile)) {
              expect(loaded.elevation!.values[tile]).toBeGreaterThanOrEqual(
                570,
              );
              expect(loaded.layout.regions[tile]).toBeLessThanOrEqual(
                loaded.layout.mainlands.length,
              );
            }
            components.add(land.component[tile]);
            areas.set(
              loaded.layout.regions[tile],
              (areas.get(loaded.layout.regions[tile]) ?? 0) + 1,
            );
          } else seaComponents.add(sea.component[tile]);
        }
        expect(components.size).toBeGreaterThanOrEqual(
          loaded.layout.islands.length + loaded.layout.mainlands.length,
        );
        expect(seaComponents.size).toBe(1);
        expect(loaded.layout.islands.length).toBeGreaterThanOrEqual(6);
        for (const island of loaded.layout.islands) {
          expect(areas.get(island.id)).toBeGreaterThan(80);
          expect(areas.get(island.id)).toBeLessThan(areas.get(1)!);
        }
        const choices = new SpawnSelection(loaded.map, {
          seed,
          aiCount: 3,
          tribes: false,
          ruleset: "ages-v1",
        });
        for (const mass of [
          ...loaded.layout.mainlands,
          ...loaded.layout.islands.filter(
            (island) => Math.min(island.radiusX, island.radiusY) >= 16,
          ),
        ])
          expect(
            choices.candidates.some(
              (tile) => loaded.layout.regions[tile] === mass.id,
            ),
          ).toBe(true);
      }
  }, 30000);
  it("accepts human island and mainland starts under unchanged game rules", () => {
    const loaded = generateMigration(250, 3),
      options = {
        seed: 3,
        aiCount: 3,
        tribes: true,
        tribeCount: 20,
        ruleset: "ages-v1" as const,
        runAi: false,
      },
      choices = new SpawnSelection(loaded.map, options),
      island = choices.candidates.find(
        (tile) => loaded.layout.regions[tile] === loaded.layout.islands[0].id,
      )!,
      mainland = choices.candidates.find(
        (tile) => loaded.layout.regions[tile] === 1,
      )!;
    for (const tile of [island, mainland]) {
      const game = new Skirmish(generateMigration(250, 3).map, {
        ...options,
        humanSpawns: [{ playerId: 1, tile }],
      });
      expect(game.players[0].base).toBe(tile);
      for (let i = 0; i < 20; i++) game.step();
      expect(game.tick).toBe(20);
    }
  }, 30000);
  it("rejects invalid sizes and seeds", () => {
    expect(() => generateMigration(128, 0)).toThrow();
    expect(() => generateMigration(250, -1)).toThrow();
  });
  it("creates sheltered coastal water pockets rather than only rounded outlines", () => {
    const loaded = generateMigration(1000, 1313198008);
    let sheltered = 0;
    const coves = new Set(
      [...loaded.layout.mainlands, ...loaded.layout.islands].flatMap(
        (mass) => mass.coves,
      ),
    );
    for (const cove of coves) {
      const x = Math.floor(cove.x),
        y = Math.floor(cove.y);
      if (
        !loaded.map.isValidCoord(x, y) ||
        !loaded.map.isWater(loaded.map.ref(x, y))
      )
        continue;
      let land = 0;
      const radius = Math.max(cove.radiusX, cove.radiusY) * 1.25;
      for (let i = 0; i < 24; i++) {
        const angle = (i * Math.PI * 2) / 24,
          xx = Math.floor(cove.x + Math.cos(angle) * radius),
          yy = Math.floor(cove.y + Math.sin(angle) * radius);
        if (
          loaded.map.isValidCoord(xx, yy) &&
          loaded.map.isLand(loaded.map.ref(xx, yy))
        )
          land++;
      }
      if (land >= 18) sheltered++;
    }
    expect(sheltered).toBeGreaterThanOrEqual(6);
    const sea = new WaterPaths(loaded.map, false),
      components = new Set<number>();
    for (let tile = 0; tile < loaded.terrain.length; tile++)
      if (loaded.map.isWater(tile)) components.add(sea.component[tile]);
    expect(components.size).toBe(1);
    expect(loaded.layout.mainlands.length).toBeLessThanOrEqual(3);
  }, 30_000);
  it.each([0, 1, 2, 3, 4, 5])(
    "adds small islands with size and preserves mainland patterns for seed %i",
    (seed) => {
      const small = generateMigration(250, seed),
        medium = generateMigration(500, seed),
        large = generateMigration(1000, seed);
      expect(medium.layout.islands.length).toBeGreaterThan(
        small.layout.islands.length,
      );
      expect(large.layout.islands.length).toBeGreaterThan(
        medium.layout.islands.length,
      );
      expect(large.layout.rivers.some((river) => river.kind === "river")).toBe(
        true,
      );
      if (large.layout.mainlandPattern === "split") {
        expect(large.layout.mainlands.length).toBeGreaterThanOrEqual(2);
        expect(large.layout.mainlands.length).toBeLessThanOrEqual(3);
        expect(
          large.layout.rivers.some((river) => river.kind === "channel"),
        ).toBe(true);
      } else expect(large.layout.mainlands).toHaveLength(1);
      expect(
        large.layout.islands.some(
          (island) => Math.min(island.radiusX, island.radiusY) < 30,
        ),
      ).toBe(true);
      const sea = new WaterPaths(large.map, false),
        seaComponents = new Set<number>();
      for (let tile = 0; tile < large.terrain.length; tile++)
        if (large.map.isWater(tile)) seaComponents.add(sea.component[tile]);
      expect(seaComponents.size).toBe(1);
    },
    30_000,
  );
  it("varies between single and split mainland patterns", () => {
    const patterns = new Set(
      Array.from(
        { length: 6 },
        (_, seed) => generateMigration(250, seed).layout.mainlandPattern,
      ),
    );
    expect(patterns).toEqual(new Set(["single", "split"]));
  });
  it("fits the existing maximum faction roster on the medium layout", () => {
    for (const seed of [0, 3, 42]) {
      const loaded = generateMigration(500, seed),
        bases = new SpawnSelection(loaded.map, {
          seed,
          aiCount: 14,
          tribes: true,
          tribeCount: 30,
          ruleset: "ages-v1",
          humanNames: Array.from({ length: 20 }, (_, i) => `H${i}`),
        }).resolve();
      expect(bases).toHaveLength(64);
      expect(new Set(bases).size).toBe(64);
    }
  }, 30_000);
  it("guards overcrowded small-map lobbies and fits representative boundary rosters", () => {
    // SpawnSelection reads the immutable map. Reuse each seeded geography
    // across roster variants rather than regenerating identical terrain five times.
    const maps = Array.from(
      { length: 12 },
      (_, seed) => generateMigration(250, seed).map,
    );
    const settings = {
      ...defaultLobbySettings("migration", 250),
      slots: 20,
      aiCount: 14,
      tribeCount: 30,
    };
    expect(() => validateLobbySettings(settings)).toThrow("too small");
    expect(() =>
      validateLobbySettings({ ...settings, worldSize: 500 }),
    ).not.toThrow();
    for (const [regular, tribes] of [
      [20, 27],
      [24, 20],
      [28, 13],
      [32, 6],
      [34, 3],
    ]) {
      expect(() =>
        validateLobbySettings({
          ...settings,
          aiCount: regular - 20,
          tribeCount: tribes,
        }),
      ).not.toThrow();
      for (let seed = 0; seed < 12; seed++) {
        const bases = new SpawnSelection(maps[seed], {
          seed,
          aiCount: regular - 20,
          tribes: true,
          tribeCount: tribes,
          ruleset: "ages-v1",
          humanNames: Array.from({ length: 20 }, (_, i) => `H${i}`),
        }).resolve();
        expect(bases).toHaveLength(regular + tribes);
      }
    }
  }, 30_000);
});
