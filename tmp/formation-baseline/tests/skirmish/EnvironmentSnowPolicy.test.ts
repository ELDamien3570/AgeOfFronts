import { describe, expect, it } from "vitest";
import { FAMILY_COLORS } from "../../src/skirmish/client/EarthTerrainCatalog";
import { TerrainDecorations } from "../../src/skirmish/client/TerrainDecorations";
import { TerrainEnvironment } from "../../src/skirmish/client/TerrainEnvironment";
import { ElevatedMap } from "../../src/skirmish/Elevation";
import {
  approximateFamily,
  decodeEnvironmentSnowPolicy,
  EnvironmentProfile,
} from "../../src/skirmish/Environment";
import { generateForestCover } from "../../src/skirmish/ForestGeneration";
import type { MapGeography } from "../../src/skirmish/Geography";
import {
  decodeHeightmap,
  type HeightmapManifest,
} from "../../src/skirmish/HeightmapMap";
import { resourceTerrainData } from "../../src/skirmish/ResourceTerrain";

const policy = {
  northernIceLatitude: 65,
  northernTransitionDegrees: 3,
  exposedRockRelief: 220,
  equatorialSnowline: 5000,
  snowlineLatitudeDrop: 20,
  minimumMountainSnowline: 4000,
};

describe("map-scoped snow policy", () => {
  it("validates finite, meaningful thresholds and isolates authored inputs", () => {
    expect(decodeEnvironmentSnowPolicy(undefined)).toBeUndefined();
    const authored = { ...policy },
      decoded = decodeEnvironmentSnowPolicy(authored)!;
    authored.northernIceLatitude = 0;
    expect(decoded.northernIceLatitude).toBe(65);
    expect(Object.isFrozen(decoded)).toBe(true);
    for (const invalid of [
      null,
      [],
      {},
      "polar-ice",
      { ...policy, northernIceLatitude: -1 },
      { ...policy, northernIceLatitude: 91 },
      { ...policy, northernTransitionDegrees: 0 },
      { ...policy, northernTransitionDegrees: 11 },
      { ...policy, exposedRockRelief: 0 },
      { ...policy, equatorialSnowline: NaN },
      { ...policy, snowlineLatitudeDrop: -1 },
      { ...policy, minimumMountainSnowline: 6000 },
      { ...policy, mountainSnowlineRegions: {} },
      { ...policy, mountainSnowlineRegions: [null] },
      {
        ...policy,
        mountainSnowlineRegions: [
          {
            latitude: 32,
            longitude: 87,
            latitudeRadius: 10,
            longitudeRadius: 22,
            snowline: NaN,
          },
        ],
      },
      {
        ...policy,
        mountainSnowlineRegions: [
          {
            latitude: 32,
            longitude: 87,
            latitudeRadius: 0,
            longitudeRadius: 22,
            snowline: 5700,
          },
        ],
      },
    ])
      expect(() => decodeEnvironmentSnowPolicy(invalid)).toThrow("snow policy");
  });

  it("isolates regional snowline settings from later authoring mutations", () => {
    const region = {
      latitude: 32,
      longitude: 87,
      latitudeRadius: 10,
      longitudeRadius: 22,
      snowline: 5700,
    };
    const authored = { ...policy, mountainSnowlineRegions: [region] };
    const decoded = decodeEnvironmentSnowPolicy(authored)!;
    region.snowline = 1;
    authored.mountainSnowlineRegions.length = 0;
    expect(decoded.mountainSnowlineRegions![0].snowline).toBe(5700);
    expect(Object.isFrozen(decoded.mountainSnowlineRegions)).toBe(true);
    expect(Object.isFrozen(decoded.mountainSnowlineRegions![0])).toBe(true);
  });

  it("retains the default classifier while allowing a higher map-specific mountain snowline", () => {
    const climate = {
      latitude: 34,
      height: 3800,
      moisture: 0.7,
      coastDistance: 5,
    };
    expect(approximateFamily(climate)).toBe("polar-ice");
    expect(approximateFamily(climate, 4320)).toBe("alpine");
    expect(approximateFamily({ ...climate, height: 4320 }, 4320)).toBe(
      "polar-ice",
    );
    expect(approximateFamily(climate)).toBe("polar-ice");
  });

  it("uses Arctic snow on flat northern land while showing exposed grey slopes and preserving water", () => {
    const width = 500,
      height = 10,
      size = width * height,
      terrain = new Uint8Array(size).fill(133),
      values = new Float32Array(size).fill(100);
    terrain[0] = 32;
    values[0] = -450;
    values[5 * width + 250] = 1000;
    values[5 * width + 350] = 5000;
    const map = new ElevatedMap(width, height, terrain, {
        values,
        minimum: -450,
        maximum: 6501,
        seaLevel: 0,
      }),
      geography: MapGeography = {
        projection: "web-mercator",
        west: 0.1,
        east: 0.4,
        north: 0.23,
        south: 0.235,
      },
      baseline = new EnvironmentProfile(map, geography),
      adjusted = new EnvironmentProfile(map, geography, [], undefined, policy),
      before = new TerrainEnvironment(map, geography, baseline),
      after = new TerrainEnvironment(map, geography, adjusted);
    expect(adjusted.familyAt(100)).toBe("polar-ice");
    expect(after.colorAt(100)).toEqual(FAMILY_COLORS.get("polar-ice"));
    expect(adjusted.familyAt(5 * width + 250)).toBe("tundra");
    expect(adjusted.familyAt(5 * width + 251)).toBe("tundra");
    expect(adjusted.familyAt(5 * width + 350)).toBe("polar-ice");
    expect(after.colorAt(0)).toEqual(before.colorAt(0));
    // The low shoreline does not become exposed rock against a deep water cell.
    expect(adjusted.familyAt(1)).toBe("polar-ice");
    expect(map.isWater(0)).toBe(true);
    expect(adjusted.heightAt(5 * width + 250)).toBe(1000);
    expect(generateForestCover(map, adjusted)).toEqual(
      generateForestCover(map, baseline),
    );
    expect(resourceTerrainData(map, adjusted)).toEqual(
      resourceTerrainData(map, baseline),
    );
    expect(new TerrainDecorations(map, after).families.has("polar-ice")).toBe(
      true,
    );
    expect(new EnvironmentProfile(map, geography).familyAt(100)).toBe("tundra");
  });

  it("breaks up the northern snow edge without turning southern tundra into Arctic", () => {
    const mercatorY = (latitude: number) =>
      (1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2;
    const map = new ElevatedMap(100, 100, new Uint8Array(10000).fill(133), {
        values: new Float32Array(10000).fill(900),
        minimum: -450,
        maximum: 6501,
        seaLevel: 0,
      }),
      geography: MapGeography = {
        projection: "web-mercator",
        west: 0.1,
        east: 0.4,
        north: mercatorY(70),
        south: mercatorY(62),
      },
      northern = new EnvironmentProfile(map, geography, [], undefined, policy),
      edges = new Set<number>();
    for (let x = 0; x < map.width(); x++) {
      let lastSnow = -1;
      for (let y = 0; y < map.height(); y++)
        if (northern.familyAt(map.ref(x, y)) === "polar-ice") lastSnow = y;
      expect(lastSnow).toBeGreaterThan(0);
      expect(lastSnow).toBeLessThan(99);
      edges.add(lastSnow);
    }
    expect(edges.size).toBeGreaterThan(5);
    const southern = new EnvironmentProfile(
      map,
      {
        ...geography,
        north: mercatorY(-62),
        south: mercatorY(-70),
      },
      [],
      undefined,
      policy,
    );
    for (let tile = 0; tile < 10000; tile++)
      expect(southern.familyAt(tile)).toBe("tundra");
  });

  it("decodes optional snow policies without changing terrain, elevation or other maps", () => {
    const size = 250 * 125,
      terrain = new Uint8Array(size).fill(133),
      heights = new Float32Array(size).fill(4000).buffer,
      manifest: HeightmapManifest = {
        schemaVersion: 1,
        name: "Fixture",
        minimum: -450,
        maximum: 6501,
        seaLevel: 0,
        variants: { 250: { width: 250, height: 125 } },
      };
    const unconfigured = decodeHeightmap(manifest, 250, terrain, heights),
      configured = decodeHeightmap(
        { ...manifest, climate: { regions: [], snowPolicy: policy } },
        250,
        terrain,
        heights,
      );
    expect(unconfigured.environment!.familyAt(0)).toBe("polar-ice");
    expect(configured.environment!.familyAt(0)).toBe("alpine");
    expect(configured.terrain).toEqual(unconfigured.terrain);
    expect(configured.elevation).toEqual(unconfigured.elevation);
    const invalid = JSON.parse(JSON.stringify(manifest));
    invalid.climate = {
      regions: [],
      snowPolicy: { ...policy, northernIceLatitude: "65" },
    };
    expect(() => decodeHeightmap(invalid, 250, terrain, heights)).toThrow(
      "snow policy",
    );
  });
});
