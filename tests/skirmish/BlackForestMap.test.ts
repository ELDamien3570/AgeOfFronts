import { describe, expect, it } from "vitest";
import { BLACK_FOREST_THEME } from "../../src/skirmish/BlackForestLayout";
import { generateBlackForest } from "../../src/skirmish/BlackForestMap";
import { SpawnSelection } from "../../src/skirmish/domain/SpawnSelection";
import { EnvironmentProfile } from "../../src/skirmish/Environment";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { mapIdentity } from "../../src/skirmish/multiplayer/application/MapIdentity";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { PathTopology } from "../../src/skirmish/PathTopology";
import { Skirmish } from "../../src/skirmish/Simulation";
import { loadMap, terrainSpeed } from "../../src/skirmish/Terrain";

describe("authored Black Forest", () => {
  for (const size of [250, 500, 1000] as const) {
    it(`${size}: regenerates identical solo and server inputs and changes with the seed`, async () => {
      const solo = await loadMap("black-forest", size, 42),
        server = await loadServerMap(
          defaultLobbySettings("black-forest", size),
          undefined,
          42,
        ),
        another = await loadServerMap(
          defaultLobbySettings("black-forest", size),
          undefined,
          43,
        ),
        identity = await mapIdentity(server.map);
      expect(
        await mapIdentity({
          width: size,
          height: size,
          terrain: solo.terrain,
          elevation: solo.elevation,
          forest: solo.forest,
          resourceTerrain: solo.resourceTerrain,
        }),
      ).toBe(identity);
      expect(await mapIdentity(another.map)).not.toBe(identity);
      expect(solo.map.width()).toBe(size);
      expect(solo.map.height()).toBe(size);
      expect(server.territoryIncomeScale).toBe(solo.territoryIncomeScale);
    }, 30_000);
  }

  it.each([0, 1, 42, 104729, 0x7fffffff])("seed %i preserves dense woodland, buildable clearings, water-free passages and traversability", (seed) => {
      const loaded = generateBlackForest(250, seed),
        topology = new PathTopology(loaded.map, "land"),
        cover = loaded.forest!.cover;
      let dense = 0,
        clear = 0,
        ponds = 0;
      for (let tile = 0; tile < cover.length; tile++) {
        if (loaded.map.isWater(tile)) {
          ponds++;
          expect(cover[tile]).toBe(0);
        } else {
          expect(topology.walkable(tile)).toBe(true);
          dense += Number(cover[tile] > 200);
          clear += Number(cover[tile] < 15);
        }
      }
      expect(dense / cover.length).toBeGreaterThan(0.4);
      expect(clear / cover.length).toBeGreaterThan(0.15);
      expect(ponds > 0).toBe(loaded.generation.pondMode !== "dry");
      for (const clearing of loaded.layout.clearings) {
        const tile = loaded.map.ref(
          Math.floor(clearing.x),
          Math.floor(clearing.y),
        );
        expect(cover[tile]).toBe(0);
        expect(terrainSpeed(loaded.map, tile)).toBe(56);
      }
      for (const passage of loaded.layout.passages)
        for (const point of passage.points) {
          const tile = loaded.map.ref(Math.floor(point.x), Math.floor(point.y));
          expect(loaded.map.isLand(tile)).toBe(true);
          expect(cover[tile]).toBeLessThan(90);
        }
      const forest = cover.findIndex((value) => value > 230);
      expect(terrainSpeed(loaded.map, forest)).toBeLessThanOrEqual(36);
      expect(loaded.environment!.familyAt(forest)).toBe("boreal-conifer");
  }, 15000);

  it("can place the full 64-faction roster without dropping seats", () => {
    for (const seed of [1, 3, 42, 2026]) {
      const loaded = generateBlackForest(250, seed);
      const bases = new SpawnSelection(loaded.map, {
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

  it("starts a real ages match, supplies Bronze inputs, and reproduces checkpoint state", () => {
    const options = {
      seed: 3,
      aiCount: 6,
      tribes: true,
      tribeCount: 20,
      humanNames: ["A", "B"],
      ruleset: "ages-v1" as const,
      runAi: false,
    };
    const a = new Skirmish(generateBlackForest(250, 3).map, options),
      b = new Skirmish(generateBlackForest(250, 3).map, options);
    expect(a.players).toHaveLength(28);
    for (const player of a.players)
      for (const resource of ["copper", "tin"] as const)
        expect(
          a.expansion!.supply.deposits.some(
            (deposit) =>
              deposit.resource === resource &&
              a.paths.connected(player.base, deposit.tile) &&
              a.map.euclideanDistSquared(player.base, deposit.tile) <= 36 ** 2,
          ),
        ).toBe(true);
    for (let i = 0; i < 100; i++) {
      a.step();
      b.step();
    }
    expect(a.tick).toBe(100);
    expect(a.checkpoint()).toEqual(b.checkpoint());
  }, 30_000);

  it("rejects invalid generator inputs and authored biome IDs", () => {
    for (const [size, seed] of [
      [128, 0],
      [250, -1],
      [250, 1.5],
      [250, Infinity],
    ])
      expect(() => generateBlackForest(size, seed)).toThrow("size or seed");
    const loaded = generateBlackForest(250, 42);
    expect(
      () =>
        new EnvironmentProfile(loaded.map, undefined, [], {
          ...loaded.environmentData!,
          families: new Uint8Array(250 * 250).fill(255),
        }),
    ).toThrow("authored map biomes");
    expect(BLACK_FOREST_THEME.revision).toBe(4);
  });

  const pondSamples = [
      ...Array.from({ length: 24 }, (_, seed) => ({ size: 250, seed })),
      ...[500, 1000].flatMap((size) =>
        [0, 1, 3].map((seed) => ({ size, seed })),
      ),
    ];
  it.each(pondSamples)("size $size seed $seed keeps pond coverage inside openings away from routes", ({ size, seed }) => {
      const loaded = generateBlackForest(size, seed),
        fraction =
          loaded.generation.pondMode === "dry"
            ? 0
            : loaded.generation.pondMode === "half"
              ? 0.5
              : 0.9;
      expect(loaded.ponds.length).toBe(
        Math.round(loaded.layout.clearings.length * fraction),
      );
      expect(new Set(loaded.ponds.map((p) => p.clearingId)).size).toBe(
        loaded.ponds.length,
      );
      for (const pond of loaded.ponds) {
        const clearing = loaded.layout.clearings[pond.clearingId],
          distance = Math.hypot(pond.x - clearing.x, pond.y - clearing.y);
        expect(
          loaded.layout.clearings.every(
            (c) => Math.hypot(pond.x - c.x, pond.y - c.y) >= distance,
          ),
        ).toBe(true);
        for (const tile of pond.tiles) {
          expect(loaded.layout.clearance[tile]).toBeGreaterThanOrEqual(4);
          expect(loaded.layout.passageClearance[tile]).toBeLessThanOrEqual(-1);
          expect(loaded.map.isWater(tile)).toBe(true);
        }
      }
      expect(loaded.terrain.filter((value) => value === 1).length).toBe(
        loaded.ponds.reduce((sum, pond) => sum + pond.tiles.length, 0),
      );
  }, 30_000);
  it("varies between all three pond coverage patterns", () => {
    const modes = new Set([0, 1, 3, 42].map(seed => generateBlackForest(250, seed).generation.pondMode));
    expect([...modes].sort()).toEqual(["dry", "half", "near-all"]);
  }, 15000);
});
