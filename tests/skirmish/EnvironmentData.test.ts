import { describe, expect, it } from "vitest";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { EnvironmentProfile } from "../../src/skirmish/Environment";
import {
  decodeEnvironmentData,
  ENVIRONMENT_ENCODING,
} from "../../src/skirmish/EnvironmentData";
import { generateForestCover } from "../../src/skirmish/ForestGeneration";
import {
  decodeHeightmap,
  type HeightmapManifest,
} from "../../src/skirmish/HeightmapMap";

describe("baked environment domain inputs", () => {
  it("decodes isolated fields and rejects invalid or truncated payloads", () => {
    const bytes = new Uint8Array([190, 230, 5, 30, 10, 220]);
    const fields = decodeEnvironmentData(bytes, 2);
    bytes.fill(0);
    expect(fields.moisture).toEqual(new Uint8Array([190, 30]));
    expect(fields.vegetation).toEqual(new Uint8Array([230, 10]));
    expect(fields.aridity).toEqual(new Uint8Array([5, 220]));
    expect(() => decodeEnvironmentData(bytes.slice(1), 2)).toThrow(
      "environment",
    );
    expect(() => decodeEnvironmentData(new Uint8Array(), 0)).toThrow(
      "environment",
    );
  });

  it("guides shared forest cover without changing elevation, passability or water", () => {
    const width = 100,
      height = 60,
      size = width * height;
    const terrain = new Uint8Array(size).fill(133);
    terrain.fill(32, 0, width);
    const map = createSkirmishMap(width, height, terrain);
    const green = {
      moisture: new Uint8Array(size).fill(200),
      vegetation: new Uint8Array(size).fill(230),
      aridity: new Uint8Array(size).fill(5),
    };
    const dry = {
      moisture: new Uint8Array(size).fill(30),
      vegetation: new Uint8Array(size).fill(10),
      aridity: new Uint8Array(size).fill(220),
    };
    const profile = new EnvironmentProfile(map, undefined, [], green);
    const before = profile.vegetationAt(1500);
    green.vegetation.fill(0);
    expect(profile.vegetationAt(1500)).toBe(before);
    const greenCover = generateForestCover(map, profile).cover;
    const dryCover = generateForestCover(
      map,
      new EnvironmentProfile(map, undefined, [], dry),
    ).cover;
    expect(greenCover.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(
      dryCover.reduce((sum, value) => sum + value, 0) + 10000,
    );
    expect(greenCover.slice(0, width).every((value) => value === 0)).toBe(true);
    expect(map.isWater(10)).toBe(true);
    expect(map.isLand(1500)).toBe(true);
    expect(profile.heightAt(1500)).toBe(100);
    expect(terrain.slice(width).every((value) => value === 133)).toBe(true);
  });

  it("refuses missing or incompatible declared environment assets instead of silently using another biome layout", () => {
    const size = 250 * 125;
    const manifest: HeightmapManifest = {
      schemaVersion: 1,
      name: "Fixture",
      minimum: -450,
      maximum: 2000,
      seaLevel: 0,
      variants: { 250: { width: 250, height: 125 } },
      environment: { schemaVersion: 1, encoding: ENVIRONMENT_ENCODING },
    };
    const terrain = new Uint8Array(size).fill(133);
    const heights = new Float32Array(size).fill(100).buffer;
    const fields = new Uint8Array(size * 3);
    expect(() => decodeHeightmap(manifest, 250, terrain, heights)).toThrow(
      "environment",
    );
    expect(() =>
      decodeHeightmap(manifest, 250, terrain, heights, fields.slice(1)),
    ).toThrow("environment");
    expect(() =>
      decodeHeightmap(
        { ...manifest, environment: { schemaVersion: 1, encoding: "unknown" } },
        250,
        terrain,
        heights,
        fields,
      ),
    ).toThrow("environment");
    expect(
      decodeHeightmap(manifest, 250, terrain, heights, fields).environmentData,
    ).toBeDefined();
  });
});
