import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { TerrainType } from "../../src/core/game/Game";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  createSkirmishMap,
  ElevatedMap,
  elevationOf,
} from "../../src/skirmish/Elevation";
import { EnvironmentProfile } from "../../src/skirmish/Environment";
import { generateForestCover } from "../../src/skirmish/ForestGeneration";
import { latitudeAt } from "../../src/skirmish/Geography";
import {
  decodeHeightmap,
  type HeightmapManifest,
} from "../../src/skirmish/HeightmapMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { terrainSpeed } from "../../src/skirmish/Terrain";
import {
  paintedCell,
  terrainRelief,
} from "../../src/skirmish/client/PaintedTerrain";
import { TerrainViewModel } from "../../src/skirmish/client/TerrainViewModel";

const root = "resources/maps/heightmap-test1";
const manifest: HeightmapManifest = JSON.parse(
  fs.readFileSync(`${root}/manifest.json`, "utf8"),
);
function load(size = 250) {
  const heights = fs.readFileSync(`${root}/${size}.heights.f32`);
  return decodeHeightmap(
    manifest,
    size,
    new Uint8Array(fs.readFileSync(`${root}/${size}.terrain.bin`)),
    heights.buffer.slice(
      heights.byteOffset,
      heights.byteOffset + heights.length,
    ),
    manifest.environment
      ? new Uint8Array(fs.readFileSync(`${root}/${size}.environment.bin`))
      : undefined,
  );
}

describe("calibrated heightmap terrain", () => {
  it("loads matching baked color fields at every resolution, with greener Europe and a drier Sahara", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = load(size);
      expect(loaded.environmentData!.moisture.length).toBe(
        loaded.terrain.length,
      );
      expect(loaded.environmentData!.vegetation.length).toBe(
        loaded.terrain.length,
      );
      expect(loaded.environmentData!.aridity.length).toBe(
        loaded.terrain.length,
      );
    }
    const loaded = load(500),
      geography = loaded.geography!,
      profile = loaded.environment!;
    if (geography.projection !== "web-mercator")
      throw new Error("Expected Earth geography");
    const europe = { vegetation: 0, aridity: 0, count: 0 };
    const sahara = { vegetation: 0, aridity: 0, count: 0 };
    for (let tile = 0; tile < loaded.terrain.length; tile++) {
      if (!loaded.map.isLand(tile)) continue;
      const latitude = latitudeAt(
        geography,
        (loaded.map.y(tile) + 0.5) / loaded.map.height(),
      );
      const longitude =
        (geography.west +
          (geography.east - geography.west) *
            ((loaded.map.x(tile) + 0.5) / loaded.map.width())) *
          360 -
        180;
      const sample =
        latitude > 45 && latitude < 49 && longitude > -2 && longitude < 5
          ? europe
          : latitude > 24 && latitude < 30 && longitude > 0 && longitude < 10
            ? sahara
            : undefined;
      if (!sample) continue;
      sample.vegetation += profile.vegetationAt(tile)!;
      sample.aridity += profile.aridityAt(tile)!;
      sample.count++;
    }
    expect(europe.count).toBeGreaterThan(30);
    expect(sahara.count).toBeGreaterThan(30);
    expect(europe.vegetation / europe.count).toBeGreaterThan(
      sahara.vegetation / sahara.count + 0.2,
    );
    expect(sahara.aridity / sahara.count).toBeGreaterThan(
      europe.aridity / europe.count + 0.2,
    );
  });

  it("greens the Test 1 western-European profile with more woodland, preserving heights and distant regions", () => {
    const loaded = load(500),
      baseline = new EnvironmentProfile(
        loaded.map,
        loaded.geography,
        [],
        loaded.environmentData,
      ),
      adjusted = loaded.environment!,
      before = generateForestCover(loaded.map, baseline).cover,
      after = generateForestCover(loaded.map, adjusted).cover,
      geography = loaded.geography!;
    if (geography.projection !== "web-mercator")
      throw new Error("Expected Earth geography");
    const regions = [
      { west: -3, east: 5, south: 44, north: 49 },
      { west: 7, east: 14, south: 49, north: 54 },
      { west: -8, east: 1, south: 42.5, north: 43.6 },
    ];
    for (const region of regions) {
      let oldCover = 0,
        newCover = 0,
        oldWoodland = 0,
        newWoodland = 0;
      for (let tile = 0; tile < after.length; tile++) {
        const latitude = latitudeAt(
            geography,
            (loaded.map.y(tile) + 0.5) / 250,
          ),
          longitude =
            (geography.west +
              (geography.east - geography.west) *
                ((loaded.map.x(tile) + 0.5) / 500)) *
              360 -
            180;
        if (
          latitude < region.south ||
          latitude > region.north ||
          longitude < region.west ||
          longitude > region.east
        )
          continue;
        oldCover += before[tile];
        newCover += after[tile];
        oldWoodland += Number(baseline.familyAt(tile) === "temperate-woodland");
        newWoodland += Number(adjusted.familyAt(tile) === "temperate-woodland");
      }
      expect(newCover).toBeGreaterThan(oldCover * 1.25);
      expect(newWoodland).toBeGreaterThan(oldWoodland);
    }
    let heightsUnchanged = true,
      distantTerrainUnchanged = true,
      waterUnforested = true;
    for (let tile = 0; tile < after.length; tile++) {
      heightsUnchanged &&= adjusted.heightAt(tile) === baseline.heightAt(tile);
      if (adjusted.latitudeAt(tile) < 40 || loaded.map.x(tile) > 200) {
        distantTerrainUnchanged &&=
          adjusted.familyAt(tile) === baseline.familyAt(tile) &&
          after[tile] === before[tile];
      }
      if (loaded.map.isWater(tile)) waterUnforested &&= after[tile] === 0;
    }
    expect(heightsUnchanged).toBe(true);
    expect(distantTerrainUnchanged).toBe(true);
    expect(waterUnforested).toBe(true);
    expect(after.some((value) => value === 0)).toBe(true);
    expect(after).toEqual(generateForestCover(loaded.map, adjusted).cover);
  });

  it("keeps sea level distinct from the normalization floor and preserves fractional metres", () => {
    const loaded = load(),
      field = elevationOf(loaded.map)!;
    let water = 0,
      inlandWater = 0,
      fractional = false,
      aboveSea = false;
    for (let tile = 0; tile < loaded.terrain.length; tile++) {
      const value = field.heightAt(tile);
      fractional ||= value !== Math.trunc(value);
      if (loaded.map.isWater(tile)) {
        water++;
        if (value > 0) inlandWater++;
        aboveSea ||= value > -450;
      } else expect(value).toBeGreaterThan(0);
    }
    expect(water).toBeGreaterThan(5000);
    expect(inlandWater).toBeGreaterThan(30);
    expect(aboveSea).toBe(true);
    expect(fractional).toBe(true);
    expect(field.minimum).toBe(-450);
    expect(field.maximum).toBe(7819);
  });

  it("reconstructs the same domain terrain and heights after a worker message clone", () => {
    const loaded = load(),
      message = structuredClone({
        terrain: loaded.terrain,
        elevation: loaded.elevation,
      }),
      workerMap = createSkirmishMap(
        250,
        125,
        message.terrain,
        message.elevation,
      ),
      workerHeight = elevationOf(workerMap)!;
    for (const tile of [0, 900, 4012, 15520, 30011]) {
      expect(workerMap.terrainType(tile)).toBe(loaded.map.terrainType(tile));
      expect(workerHeight.heightAt(tile)).toBe(
        elevationOf(loaded.map)!.heightAt(tile),
      );
    }
    loaded.elevation!.values.fill(777);
    expect(elevationOf(loaded.map)!.heightAt(0)).not.toBe(777);
    expect(workerHeight.heightAt(0)).not.toBe(777);
  });

  it("retains existing movement tiers and passability with elevation independent of visual relief", () => {
    const loaded = load(),
      shades = terrainRelief(loaded.map)!;
    const before = Array.from(loaded.terrain);
    for (let tile = 0; tile < loaded.terrain.length; tile++) {
      const value = elevationOf(loaded.map)!.heightAt(tile);
      if (!loaded.map.isLand(tile)) continue;
      const type =
        value < 600
          ? TerrainType.Plains
          : value < 1800
            ? TerrainType.Highland
            : TerrainType.Mountain;
      expect(loaded.map.terrainType(tile)).toBe(type);
      expect(terrainSpeed(loaded.map, tile)).toBe(
        type === TerrainType.Plains
          ? 56
          : type === TerrainType.Highland
            ? 35
            : 20,
      );
    }
    expect(shades.some((value) => value < 0)).toBe(true);
    expect(shades.some((value) => value > 0)).toBe(true);
    paintedCell(loaded.map, 15000, shades);
    expect(Array.from(loaded.terrain)).toEqual(before);
  });

  it("starts 20 factions on viable land on the imported map and accepts ordinary move orders", () => {
    const loaded = load(),
      match = new Skirmish(loaded.map, { seed: 42, humanNames: ["H1", "H2", "H3", "H4", "H5", "H6"], aiCount: 14, runAi: false });
    expect(match.players).toHaveLength(20);
    for (const player of match.players) {
      expect(match.map.isLand(player.base)).toBe(true);
      expect(match.paths.walkable(player.base)).toBe(true);
    }
    const squad = match.squads[0];
    const goal = Array.from(match.paths.component.keys()).find(tile => match.paths.connected(tile, match.tileOf(squad)) && match.map.manhattanDist(tile, match.tileOf(squad)) > 8)!;
    expect(
      match.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [squad.id],
        order: { type: "move", tile: goal },
      }),
    ).toBeNull();
    const start = { x: squad.x, y: squad.y };
    for (let tick = 0; tick < 40; tick++) match.step();
    expect({ x: squad.x, y: squad.y }).not.toEqual(start);
  });

  it("shows calibrated elevation for imported terrain while preserving the original map readout", () => {
    const loaded = load();
    expect(new TerrainViewModel(loaded.map).describe(0)).toContain(
      "-450 m elevation",
    );
    const legacy = new GameMapImpl(1, 1, new Uint8Array([133]), 1);
    expect(new TerrainViewModel(legacy).describe(0)).toBe(
      "Plains · 100% speed",
    );
    expect(terrainRelief(legacy)).toBeUndefined();
  });

  it("rejects corrupt geometry, missing height bytes and non-finite elevation before a match starts", () => {
    const terrain = new Uint8Array(250 * 125).fill(133);
    expect(() =>
      decodeHeightmap(manifest, 250, terrain, new ArrayBuffer(0)),
    ).toThrow(/assets/);
    expect(() =>
      decodeHeightmap(
        { ...manifest, variants: { 250: { width: 125, height: 250 } } },
        250,
        terrain,
        new ArrayBuffer(terrain.length * 4),
      ),
    ).toThrow(/assets/);
    const data = new Float32Array(4).fill(1);
    data[2] = NaN;
    expect(
      () =>
        new ElevatedMap(2, 2, new Uint8Array(4).fill(133), {
          values: data,
          minimum: -450,
          maximum: 7819,
          seaLevel: 0,
        }),
    ).toThrow(/sample/);
  });
});
