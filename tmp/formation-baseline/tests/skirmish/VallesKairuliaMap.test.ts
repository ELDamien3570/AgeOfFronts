import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeHeightmap,
  type HeightmapManifest,
} from "../../src/skirmish/HeightmapMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { Skirmish } from "../../src/skirmish/Simulation";

function load(size = 250) {
  const root = "resources/maps/valles-kairulia";
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
    throw new Error("Expected registered source geography");
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

describe("Valles Kairulia source-calibrated map", () => {
  it("loads all three square sizes with finite calibrated elevations and coherent water", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = load(size),
        landPaths = new LandPaths(loaded.map, false),
        waterPaths = new WaterPaths(loaded.map);
      expect(loaded.map.width()).toBe(size);
      expect(loaded.map.height()).toBe(size);
      expect(loaded.name).toBe(`Valles Kairulia · ${size}×${size}`);
      expect(loaded.environmentData!.vegetation.length).toBe(size * size);
      let valid = true,
        land = 0,
        alpine = 0,
        snow = 0;
      for (let tile = 0; tile < loaded.terrain.length; tile++) {
        const height = loaded.elevation!.values[tile];
        valid &&=
          Number.isFinite(height) && height >= -450 && height <= 1819.473;
        if (loaded.map.isLand(tile)) {
          land++;
          valid &&= height > 0;
          alpine += Number(loaded.environment!.familyAt(tile) === "alpine");
          snow += Number(loaded.environment!.familyAt(tile) === "polar-ice");
        } else {
          valid &&= waterPaths.walkable(tile) && !landPaths.walkable(tile);
          valid &&= loaded.environmentData!.vegetation[tile] === 0;
        }
      }
      expect(valid).toBe(true);
      expect(land / (size * size)).toBeGreaterThan(0.24);
      expect(land / (size * size)).toBeLessThan(0.28);
      expect(alpine).toBeGreaterThan(0);
      expect(snow).toBe(0);
    }
  });

  it("retains greener wooded uplands, dry southern lowlands and source-limited grey summits", () => {
    const loaded = load(500),
      wooded = tileAt(loaded, 16.4, 39.3),
      dry = tileAt(loaded, 10, 35.5),
      summit = tileAt(loaded, 15, 37.75);
    expect(loaded.map.isLand(wooded)).toBe(true);
    expect(loaded.map.isLand(dry)).toBe(true);
    expect(loaded.environment!.moistureAt(wooded)).toBeGreaterThan(0.65);
    expect(loaded.environmentData!.vegetation[wooded] / 255).toBeGreaterThan(
      0.7,
    );
    expect(loaded.environment!.moistureAt(dry)).toBeLessThan(0.3);
    expect(loaded.environmentData!.vegetation[dry] / 255).toBeLessThan(0.2);
    expect(loaded.environment!.familyAt(summit)).toBe("alpine");
    // Respect the supplied export's ceiling instead of replacing it with external DEM heights.
    expect(loaded.elevation!.values[summit]).toBeGreaterThan(1800);
    expect(loaded.elevation!.values[summit]).toBeLessThan(1819.473);
  });

  it("keeps open-water routes around the islands at every resolution", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = load(size),
        water = new WaterPaths(loaded.map);
      const north = tileAt(loaded, 12, 39),
        south = tileAt(loaded, 16, 36);
      expect(loaded.map.isWater(north)).toBe(true);
      expect(loaded.map.isWater(south)).toBe(true);
      expect(water.connected(north, south)).toBe(true);
      expect(water.find(north, south)).not.toBeNull();
    }
  });

  it("retains flat, vegetation-free lake surfaces and water paths at every size", () => {
    const expectedCounts = {
      250: [3, 8, 3],
      500: [13, 34, 15],
      1000: [53, 129, 61],
    };
    for (const size of [250, 500, 1000] as const) {
      const loaded = load(size),
        water = new WaterPaths(loaded.map),
        land = new LandPaths(loaded.map, false);
      for (const [index, elevation] of [6, 305, 164].entries()) {
        const tiles: number[] = [];
        for (let tile = 0; tile < loaded.terrain.length; tile++) {
          if (
            loaded.elevation!.values[tile] === elevation &&
            loaded.map.isWater(tile)
          )
            tiles.push(tile);
        }
        expect(tiles).toHaveLength(expectedCounts[size][index]);
        for (const tile of tiles) {
          expect(water.walkable(tile)).toBe(true);
          expect(land.walkable(tile)).toBe(false);
          expect(loaded.environmentData!.vegetation[tile]).toBe(0);
        }
        expect(water.connected(tiles[0], tiles[tiles.length - 1])).toBe(true);
        expect(water.find(tiles[0], tiles[tiles.length - 1])).not.toBeNull();
      }
    }
  });

  it("connects source river channels to the sea without lowering inland heights", () => {
    const sourceSamples = {
      "250": {
        Ofanto: [168, 53],
        Tevere: [100, 17],
        Simeto: [151, 151],
        Salto: [116, 21],
        Volturno: [145, 50],
        Sacco: [119, 39],
      },
      "500": {
        Ofanto: [343, 106],
        Tevere: [205, 35],
        Simeto: [294, 304],
        Salto: [232, 38],
        Volturno: [306, 100],
        Sacco: [246, 80],
      },
      "1000": {
        Ofanto: [692, 211],
        Tevere: [405, 69],
        Simeto: [600, 606],
        Salto: [462, 79],
        Volturno: [617, 200],
        Sacco: [485, 160],
      },
    };
    for (const size of [250, 500, 1000] as const) {
      const loaded = load(size),
        water = new WaterPaths(loaded.map),
        ocean = tileAt(loaded, 12, 39);
      for (const [name, [x, y]] of Object.entries(sourceSamples[size])) {
        const inland = loaded.map.ref(x, y);
        expect(loaded.map.isWater(inland)).toBe(true);
        expect(loaded.elevation!.values[inland]).toBeGreaterThan(0);
        expect(loaded.environmentData!.vegetation[inland]).toBe(0);
        expect(water.connected(inland, ocean), name).toBe(true);
        expect(water.find(inland, ocean), name).not.toBeNull();
      }
    }
  });

  it("starts twenty factions on viable land and advances a match", () => {
    const loaded = load(),
      match = new Skirmish(loaded.map, {
        ruleset: "ages-v1",
        aiCount: 14,
        humanNames: Array.from({ length: 6 }, (_, i) => `Human ${i + 1}`),
        tribes: false,
        runAi: false,
        seed: 44,
      });
    expect(match.players).toHaveLength(20);
    for (const player of match.players) {
      expect(loaded.map.isLand(player.base)).toBe(true);
      expect(match.paths.walkable(player.base)).toBe(true);
    }
    match.step();
    expect(match.tick).toBe(1);
  });
});
