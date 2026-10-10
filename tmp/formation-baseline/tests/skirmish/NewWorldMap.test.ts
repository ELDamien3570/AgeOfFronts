import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeHeightmap,
  type HeightmapManifest,
} from "../../src/skirmish/HeightmapMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { Skirmish } from "../../src/skirmish/Simulation";

function load(size = 250) {
  const root = "resources/maps/new-world";
  const manifest: HeightmapManifest = JSON.parse(
    fs.readFileSync(`${root}/manifest.json`, "utf8"),
  );
  const heights = fs.readFileSync(`${root}/${size}.heights.f32`);
  return decodeHeightmap(
    manifest,
    size,
    new Uint8Array(fs.readFileSync(`${root}/${size}.terrain.bin`)),
    heights.buffer.slice(
      heights.byteOffset,
      heights.byteOffset + heights.length,
    ),
    new Uint8Array(fs.readFileSync(`${root}/${size}.environment.bin`)),
  );
}

function tileAt(loaded: ReturnType<typeof load>, lon: number, lat: number) {
  const geo = loaded.geography!;
  if (geo.projection !== "web-mercator")
    throw new Error("Expected Earth geography");
  return loaded.map.ref(
    Math.floor(
      (((lon + 180) / 360 - geo.west) / (geo.east - geo.west)) *
        loaded.map.width(),
    ),
    Math.floor(
      (((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2 -
        geo.north) /
        (geo.south - geo.north)) *
        loaded.map.height(),
    ),
  );
}

describe("New World calibrated map", () => {
  it("loads all portrait variants with finite heights, navigable rivers and land-only vegetation", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = load(size),
        width = Math.round((size * 3) / 4);
      expect(loaded.map.width()).toBe(width);
      expect(loaded.map.height()).toBe(size);
      expect(loaded.name).toBe(`New World · ${width}×${size}`);
      expect(loaded.environmentData!.vegetation.length).toBe(width * size);
      const landPaths = new LandPaths(loaded.map, false),
        waterPaths = new WaterPaths(loaded.map);
      let valid = true,
        inlandWater = 0,
        land = 0;
      for (let tile = 0; tile < loaded.terrain.length; tile++) {
        const elevation = loaded.elevation!.values[tile];
        valid &&=
          Number.isFinite(elevation) && elevation >= -450 && elevation <= 6501;
        if (loaded.map.isLand(tile)) {
          land++;
          valid &&= elevation > 0;
        } else {
          valid &&= loaded.environmentData!.vegetation[tile] === 0;
          if (elevation > 0) {
            inlandWater++;
            valid &&= waterPaths.walkable(tile) && !landPaths.walkable(tile);
          }
        }
      }
      expect(valid).toBe(true);
      expect(land).toBeGreaterThan(width * size * 0.2);
      expect(land).toBeLessThan(width * size * 0.5);
      expect(inlandWater).toBeGreaterThan(500);
    }
  });

  it("retains humid Amazon and eastern woodland, dry Atacama, and elevated Andes", () => {
    const loaded = load(500);
    function region(lon: number, lat: number) {
      const center = tileAt(loaded, lon, lat);
      let moisture = 0,
        vegetation = 0,
        elevation = 0,
        count = 0;
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          const tile = loaded.map.ref(
            loaded.map.x(center) + dx,
            loaded.map.y(center) + dy,
          );
          if (!loaded.map.isLand(tile)) continue;
          count++;
          moisture += loaded.environment!.moistureAt(tile);
          vegetation += loaded.environmentData!.vegetation[tile] / 255;
          elevation += loaded.elevation!.values[tile];
        }
      expect(count).toBeGreaterThan(20);
      return {
        moisture: moisture / count,
        vegetation: vegetation / count,
        elevation: elevation / count,
      };
    }
    const amazon = region(-64, -8),
      atacama = region(-69, -23),
      easternWoodland = region(-82, 35),
      andes = region(-70, -30);
    expect(amazon.moisture).toBeGreaterThan(0.75);
    expect(amazon.vegetation).toBeGreaterThan(0.8);
    expect(easternWoodland.vegetation).toBeGreaterThan(0.7);
    expect(atacama.moisture).toBeLessThan(0.3);
    expect(atacama.vegetation).toBeLessThan(0.2);
    expect(amazon.moisture - atacama.moisture).toBeGreaterThan(0.5);
    expect(andes.elevation).toBeGreaterThan(1800);
  });

  it("connects Mississippi, Paraná and Mackenzie inland channels to their oceans at every size", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = load(size),
        water = new WaterPaths(loaded.map);
      for (const [lon, lat, oceanLon, oceanLat] of [
        [-91.069244, 32.048122, -90, 28],
        [-60.605417, -31.699884, -56, -36],
        [-124.062082, 63.892157, -135, 70],
      ]) {
        const inland = tileAt(loaded, lon, lat),
          ocean = tileAt(loaded, oceanLon, oceanLat);
        expect(loaded.map.isWater(inland)).toBe(true);
        expect(loaded.map.isWater(ocean)).toBe(true);
        expect(water.connected(inland, ocean)).toBe(true);
        expect(water.find(inland, ocean)).not.toBeNull();
      }
    }
  });

  it("starts twenty factions on viable land and advances the simulation", () => {
    const loaded = load();
    const match = new Skirmish(loaded.map, {
      ruleset: "ages-v1",
      aiCount: 14,
      humanNames: Array.from({ length: 6 }, (_, i) => `Human ${i + 1}`),
      tribes: false,
      runAi: false,
      seed: 43,
    });
    expect(match.players).toHaveLength(20);
    for (const player of match.players) {
      expect(loaded.map.isLand(player.base)).toBe(true);
    }
    match.step();
    expect(match.tick).toBe(1);
  });
});
