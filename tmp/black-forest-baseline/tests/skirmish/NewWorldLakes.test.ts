import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { terrainRelief } from "../../src/skirmish/client/PaintedTerrain";
import { TerrainEnvironment } from "../../src/skirmish/client/TerrainEnvironment";
import { generateForestCover } from "../../src/skirmish/ForestGeneration";
import {
  decodeHeightmap,
  type HeightmapManifest,
} from "../../src/skirmish/HeightmapMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";

function load(size: number) {
  const root = "resources/maps/new-world",
    manifest: HeightmapManifest = JSON.parse(
      fs.readFileSync(`${root}/manifest.json`, "utf8"),
    ),
    bytes = fs.readFileSync(`${root}/${size}.heights.f32`);
  return decodeHeightmap(
    manifest,
    size,
    new Uint8Array(fs.readFileSync(`${root}/${size}.terrain.bin`)),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    new Uint8Array(fs.readFileSync(`${root}/${size}.environment.bin`)),
  );
}

describe("New World Great Lakes surfaces", () => {
  it.each([250, 500, 1000])(
    "loads flat elevated water with boat paths, land barriers and correct shore rendering at size %i",
    (size) => {
      const loaded = load(size),
        map = loaded.map,
        geography = loaded.geography!;
      if (geography.projection !== "web-mercator")
        throw new Error("Expected geographic registration");
      const tileAt = (lon: number, lat: number) =>
        map.ref(
          Math.floor(
            (((lon + 180) / 360 - geography.west) /
              (geography.east - geography.west)) *
              map.width(),
          ),
          Math.floor(
            (((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2 -
              geography.north) /
              (geography.south - geography.north)) *
              map.height(),
          ),
        );
      const water = new WaterPaths(map),
        land = new LandPaths(map, false),
        environment = new TerrainEnvironment(
          map,
          geography,
          loaded.environment,
        ),
        forest = generateForestCover(map, loaded.environment!),
        relief = terrainRelief(map)!;
      // Interior points from the actual geographic lake polygons, spanning
      // each lake. Inter-lake straits are separately resolution-limited.
      for (const [level, lon1, lat1, lon2, lat2] of [
        [183.2, -89, 47.3, -86.5, 47.5],
        [176, -87, 43, -86.5, 45],
        [176, -82.6, 43.9, -83, 45.5],
        [173.5, -82, 41.9, -80.5, 42.3],
        [74.2, -78.5, 43.6, -77, 43.9],
      ]) {
        const first = tileAt(lon1, lat1),
          second = tileAt(lon2, lat2);
        for (const tile of [first, second]) {
          expect(map.isWater(tile)).toBe(true);
          expect(water.walkable(tile)).toBe(true);
          expect(land.walkable(tile)).toBe(false);
          expect(loaded.elevation!.values[tile]).toBeCloseTo(level, 3);
          expect(loaded.environmentData!.vegetation[tile]).toBe(0);
          expect(forest.cover[tile]).toBe(0);
          expect(relief[tile]).toBe(0);
          expect(environment.colorAt(tile)).toEqual(
            loaded.environment!.shallow(tile) ? [77, 128, 143] : [48, 91, 116],
          );
        }
        expect(water.connected(first, second)).toBe(true);
        expect(water.find(first, second)).not.toBeNull();
      }
      // The source includes Saint Clair, but no majority-area cell survives at
      // 250. Its existing river still supplies navigable water at that size.
      if (size >= 500)
        expect(loaded.elevation!.values[tileAt(-82.7, 42.45)]).toBeCloseTo(
          174.4,
          3,
        );
      let coherent = true;
      for (let tile = 0; tile < loaded.terrain.length; tile++) {
        const adjacentWater = map
          .neighbors(tile)
          .some((other) => map.isWater(other));
        coherent &&=
          Boolean(loaded.terrain[tile] & 64) ===
          (map.isLand(tile) && adjacentWater);
      }
      expect(coherent).toBe(true);
    },
  );
});
