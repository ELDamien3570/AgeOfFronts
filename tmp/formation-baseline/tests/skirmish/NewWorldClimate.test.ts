import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { FAMILY_COLORS } from "../../src/skirmish/client/EarthTerrainCatalog";
import { TerrainEnvironment } from "../../src/skirmish/client/TerrainEnvironment";
import { EnvironmentProfile } from "../../src/skirmish/Environment";
import { generateForestCover } from "../../src/skirmish/ForestGeneration";
import {
  decodeHeightmap,
  type HeightmapManifest,
} from "../../src/skirmish/HeightmapMap";
import { resourceTerrainData } from "../../src/skirmish/ResourceTerrain";

describe("New World northern snow and grey mountains", () => {
  it.each([250, 500, 1000])(
    "keeps Arctic snow at the top, grey Southwest mountains and snow only on the highest Andes peaks at size %i",
    (size) => {
      const root = "resources/maps/new-world",
        manifest: HeightmapManifest = JSON.parse(
          fs.readFileSync(`${root}/manifest.json`, "utf8"),
        ),
        authoredClimate = JSON.parse(
          fs.readFileSync("HeightMaps/New World/climate.json", "utf8"),
        );
      expect(manifest.climate).toEqual(authoredClimate);
      const policy = manifest.climate!.snowPolicy!;
      expect(policy.northernIceLatitude).toBe(65);
      const heights = fs.readFileSync(`${root}/${size}.heights.f32`),
        loaded = decodeHeightmap(
          manifest,
          size,
          new Uint8Array(fs.readFileSync(`${root}/${size}.terrain.bin`)),
          heights.buffer.slice(
            heights.byteOffset,
            heights.byteOffset + heights.length,
          ),
          new Uint8Array(fs.readFileSync(`${root}/${size}.environment.bin`)),
        ),
        baseline = new EnvironmentProfile(
          loaded.map,
          loaded.geography,
          [],
          loaded.environmentData,
        ),
        adjusted = loaded.environment!,
        before = new TerrainEnvironment(loaded.map, loaded.geography, baseline),
        after = new TerrainEnvironment(loaded.map, loaded.geography, adjusted),
        geography = loaded.geography!;
      let north = 0,
        northSnow = 0,
        northRock = 0,
        southernMountains = 0,
        southernSnow = 0,
        southwestMountains = 0,
        water = 0,
        consistent = true;
      for (let tile = 0; tile < loaded.terrain.length; tile++) {
        const latitude = adjusted.latitudeAt(tile),
          elevation = adjusted.heightAt(tile),
          family = adjusted.familyAt(tile),
          previous = baseline.familyAt(tile),
          snowline = Math.max(
            policy.minimumMountainSnowline,
            policy.equatorialSnowline -
              Math.abs(latitude) * policy.snowlineLatitudeDrop,
          ),
          longitude =
            (geography.west +
              (geography.east - geography.west) *
                ((loaded.map.x(tile) + 0.5) / loaded.map.width())) *
              360 -
            180;
        consistent &&=
          elevation === baseline.heightAt(tile) &&
          adjusted.moistureAt(tile) === baseline.moistureAt(tile) &&
          adjusted.vegetationAt(tile) === baseline.vegetationAt(tile) &&
          adjusted.aridityAt(tile) === baseline.aridityAt(tile);
        if (loaded.map.isWater(tile)) {
          water++;
          consistent &&=
            family === previous &&
            after
              .colorAt(tile)
              .every(
                (channel, index) => channel === before.colorAt(tile)[index],
              );
          continue;
        }
        if (
          latitude >=
          policy.northernIceLatitude + policy.northernTransitionDegrees / 2
        ) {
          north++;
          if (family === "polar-ice") northSnow++;
          else if (family === "tundra" || family === "alpine") northRock++;
          else consistent = false;
        } else {
          const expected =
            previous === "polar-ice" && elevation < snowline
              ? "alpine"
              : previous;
          const northernTransition =
            latitude >=
              policy.northernIceLatitude - policy.northernTransitionDegrees &&
            ["tundra", "alpine", "polar-ice"].includes(previous);
          consistent &&=
            family === expected ||
            (northernTransition && family === "polar-ice");
          if (family === "polar-ice" && !northernTransition)
            consistent &&= elevation >= snowline;
        }
        if (latitude < 0 && elevation >= 1800) {
          southernMountains++;
          if (family === "polar-ice") southernSnow++;
          else consistent &&= family === "alpine";
        }
        if (
          latitude >= 30 &&
          latitude <= 38 &&
          longitude >= -117 &&
          longitude <= -105 &&
          elevation >= 1800
        ) {
          southwestMountains++;
          consistent &&= family === "alpine";
        }
        if (
          family === "polar-ice" ||
          family === "alpine" ||
          family === "tundra"
        )
          consistent &&= after
            .colorAt(tile)
            .every(
              (channel, index) => channel === FAMILY_COLORS.get(family)![index],
            );
      }
      expect(consistent).toBe(true);
      expect(north).toBeGreaterThan(1000);
      expect(northSnow / north).toBeGreaterThan(0.6);
      expect(northRock / north).toBeGreaterThan(0.03);
      expect(northRock / north).toBeLessThan(0.4);
      expect(southwestMountains).toBeGreaterThan(20);
      expect(southernMountains).toBeGreaterThan(100);
      expect(southernSnow).toBeGreaterThan(0);
      expect(southernSnow / southernMountains).toBeLessThan(0.15);
      expect(water).toBeGreaterThan(1000);
      expect(generateForestCover(loaded.map, adjusted)).toEqual(
        generateForestCover(loaded.map, baseline),
      );
      expect(resourceTerrainData(loaded.map, adjusted)).toEqual(
        resourceTerrainData(loaded.map, baseline),
      );
    },
    // The largest variant checks 750,000 cells and regenerates both cover fields.
    15_000,
  );
});
