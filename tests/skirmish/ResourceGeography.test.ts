import { describe, expect, it } from "vitest";
import { generateBlackForest } from "../../src/skirmish/BlackForestMap";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { generateMigration } from "../../src/skirmish/MigrationMap";
import {
  RESOURCE_SUITABILITY_ORDER,
  resourceTerrainOf,
} from "../../src/skirmish/ResourceTerrain";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  DEPOSIT_RULES,
  generateDeposits,
} from "../../src/skirmish/domain/DepositGeneration";
import { SpawnSelection } from "../../src/skirmish/domain/SpawnSelection";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { mapIdentity } from "../../src/skirmish/multiplayer/application/MapIdentity";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";

describe("procedural resource geography", () => {
  it("preserves reachable starting resources on both geography-aware themes", () => {
    for (const loaded of [
      generateBlackForest(250, 42),
      generateMigration(250, 42),
    ]) {
      const options = {
          seed: 42,
          aiCount: 1,
          tribes: false,
          runAi: false,
          ruleset: "ages-v1" as const,
        },
        choices = new SpawnSelection(loaded.map, options),
        regions =
          "regions" in loaded.layout ? loaded.layout.regions : undefined,
        start = regions
          ? choices.candidates.find((tile) => regions[tile] === 1)!
          : choices.candidates[0],
        match = new Skirmish(loaded.map, {
          ...options,
          humanSpawns: [{ playerId: 1, tile: start }],
        }),
        player = match.players[0],
        distances = new Map([[player.base, 0]]),
        queue = [player.base];
      for (let head = 0; head < queue.length; head++) {
        const tile = queue[head],
          distance = distances.get(tile)! + 1;
        if (distance > DEPOSIT_RULES.startingReach) continue;
        match.map.forEachNeighbor(tile, (next) => {
          if (
            distances.has(next) ||
            !match.paths.walkable(next) ||
            (match.owners[next] && match.owners[next] !== player.id)
          )
            return;
          distances.set(next, distance);
          queue.push(next);
        });
      }
      for (const resource of RESOURCE_SUITABILITY_ORDER)
        expect(
          match.expansion!.supply.deposits.some(
            (d) => d.resource === resource && distances.has(d.tile),
          ),
          `${loaded.generation.theme}: ${resource}`,
        ).toBe(true);
    }
  });
  it("places Black Forest horses in open ground and keeps every pond free of oil", () => {
    const loaded = generateBlackForest(500, 3),
      deposits = Array.from({ length: 16 }, (_, seed) =>
        generateDeposits(loaded.map, seed * 197 + 11),
      ).flat(),
      horses = deposits.filter((d) => d.resource === "horses");
    let cover = 0,
      land = 0;
    for (let tile = 0; tile < loaded.terrain.length; tile++)
      if (loaded.map.isLand(tile)) {
        cover += loaded.forest!.cover[tile];
        land++;
      }
    expect(horses.length).toBeGreaterThan(900);
    expect(
      horses.reduce((sum, d) => sum + loaded.forest!.cover[d.tile], 0) /
        horses.length,
    ).toBeLessThan((cover / land) * 0.6);
    expect(deposits.every((d) => loaded.map.isLand(d.tile))).toBe(true);
    expect(deposits.every((d) => !loaded.map.isImpassable(d.tile))).toBe(true);
  });

  it("draws minerals from correlated provinces without inflating global budgets", () => {
    const loaded = generateMigration(500, 3),
      geography = resourceTerrainOf(loaded.map)!,
      deposits = Array.from({ length: 20 }, (_, seed) =>
        generateDeposits(loaded.map, seed * 1987 + 3),
      ).flat();
    let land = 0;
    const sums = new Float64Array(8);
    for (let tile = 0; tile < loaded.terrain.length; tile++) {
      if (!loaded.map.isLand(tile) || loaded.map.isImpassable(tile)) continue;
      land++;
      for (let i = 0; i < 8; i++)
        sums[i] += geography.suitability![tile * 8 + i];
    }
    for (const resource of [
      "stone",
      "copper",
      "tin",
      "ironOre",
      "carbon",
      "gunpowder",
    ] as const) {
      const index = RESOURCE_SUITABILITY_ORDER.indexOf(resource),
        selected = deposits.filter((d) => d.resource === resource),
        mean =
          selected.reduce(
            (sum, d) => sum + geography.suitability![d.tile * 8 + index],
            0,
          ) / selected.length,
        expected =
          ((land * 20 * 2) / 6300) * (resource === "gunpowder" ? 2 : 1);
      expect(mean, resource).toBeGreaterThan((sums[index] / land) * 1.25);
      expect(selected.length / expected, resource).toBeGreaterThan(0.8);
      expect(selected.length / expected, resource).toBeLessThan(1.2);
    }
    const offshore = deposits.filter((d) => loaded.map.isWater(d.tile));
    expect(offshore.length).toBeGreaterThan(20);
    expect(
      offshore.every(
        (d) =>
          d.resource === "oil" &&
          loaded.elevation!.values[d.tile] <= 0 &&
          geography.marine![d.tile] === 1,
      ),
    ).toBe(true);
    expect(deposits.every((d) => !loaded.map.isImpassable(d.tile))).toBe(true);
  });

  it("transports the complete immutable resource fields through worker structured clones", () => {
    const loaded = generateBlackForest(250, 42),
      data = structuredClone(loaded.resourceTerrain!),
      reconstructed = createSkirmishMap(
        250,
        250,
        loaded.terrain,
        loaded.elevation,
        loaded.forest,
        data,
      ),
      before = generateDeposits(reconstructed, 97);
    expect(before).toEqual(generateDeposits(loaded.map, 97));
    expect(generateDeposits(reconstructed, 98)).not.toEqual(before);
    data.suitability!.fill(0);
    data.marine!.fill(1);
    expect(generateDeposits(reconstructed, 97)).toEqual(before);
    expect(new Set(before.map((d) => d.tile)).size).toBe(before.length);
  });

  it("hashes geography and gives solo and server identical placement inputs", async () => {
    for (const theme of ["black-forest", "migration"] as const) {
      const loaded =
          theme === "migration"
            ? generateMigration(250, 42)
            : generateBlackForest(250, 42),
        server = await loadServerMap(
          defaultLobbySettings(theme, 250),
          undefined,
          42,
        ),
        runtime = {
          width: 250,
          height: 250,
          terrain: loaded.terrain,
          elevation: loaded.elevation,
          forest: loaded.forest,
          resourceTerrain: loaded.resourceTerrain,
        },
        identity = await mapIdentity(runtime),
        changed = structuredClone(runtime);
      expect(await mapIdentity(server.map)).toBe(identity);
      changed.resourceTerrain!.suitability![123] ^= 1;
      expect(await mapIdentity(changed)).not.toBe(identity);
      changed.resourceTerrain = structuredClone(runtime.resourceTerrain);
      changed.resourceTerrain!.marine![123] ^= 1;
      expect(await mapIdentity(changed)).not.toBe(identity);
    }
  });

  it("rejects malformed geography buffers instead of silently losing multiplayer inputs", () => {
    const terrain = new Uint8Array(100).fill(133),
      desert = new Uint8Array(100);
    expect(() =>
      createSkirmishMap(10, 10, terrain, undefined, undefined, {
        desert,
        suitability: new Uint8Array(100),
      }),
    ).toThrow(/suitability/);
    expect(() =>
      createSkirmishMap(10, 10, terrain, undefined, undefined, {
        desert,
        marine: new Uint8Array(99),
      }),
    ).toThrow(/marine/);
  });
});
