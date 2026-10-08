import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { EnvironmentProfile } from "../../src/skirmish/Environment";
import {
  decodeHeightmap,
  type HeightmapManifest,
} from "../../src/skirmish/HeightmapMap";
import { climateInfluence } from "../../src/skirmish/RegionalClimate";

describe("Himalayan regional snow extent", () => {
  for (const [id, folder] of [
    ["old-world", "Old World"],
    ["down-unda", "Down Unda"],
  ]) {
    it.each([250, 500, 1000])(
      `${id} exposes more rock while retaining summit snow at size %i`,
      (size) => {
        const root = `resources/maps/${id}`;
        const manifest: HeightmapManifest = JSON.parse(
          fs.readFileSync(`${root}/manifest.json`, "utf8"),
        );
        expect(manifest.climate).toEqual(
          JSON.parse(
            fs.readFileSync(`HeightMaps/${folder}/snow-climate.json`, "utf8"),
          ),
        );
        const heights = fs.readFileSync(`${root}/${size}.heights.f32`);
        const loaded = decodeHeightmap(
          manifest,
          size,
          new Uint8Array(fs.readFileSync(`${root}/${size}.terrain.bin`)),
          heights.buffer.slice(
            heights.byteOffset,
            heights.byteOffset + heights.length,
          ),
          new Uint8Array(fs.readFileSync(`${root}/${size}.environment.bin`)),
        );
        const before = new EnvironmentProfile(
          loaded.map,
          loaded.geography,
          [],
          loaded.environmentData,
        );
        const after = loaded.environment!;
        const region =
          manifest.climate!.snowPolicy!.mountainSnowlineRegions![0];
        const geography = loaded.geography!;
        let previousSnow = 0,
          currentSnow = 0,
          exposedRock = 0,
          unchangedOutside = true,
          unchangedInputs = true;
        for (let tile = 0; tile < loaded.terrain.length; tile++) {
          const longitude =
            (geography.west +
              (geography.east - geography.west) *
                ((loaded.map.x(tile) + 0.5) / loaded.map.width())) *
              360 -
            180;
          const influence = climateInfluence(
            region,
            after.latitudeAt(tile),
            longitude,
          );
          unchangedInputs &&=
            after.heightAt(tile) === before.heightAt(tile) &&
            after.moistureAt(tile) === before.moistureAt(tile) &&
            after.vegetationAt(tile) === before.vegetationAt(tile) &&
            after.aridityAt(tile) === before.aridityAt(tile);
          if (influence === 0 || loaded.map.isWater(tile)) {
            unchangedOutside &&= after.familyAt(tile) === before.familyAt(tile);
            continue;
          }
          if (before.familyAt(tile) === "polar-ice") previousSnow++;
          if (after.familyAt(tile) === "polar-ice") currentSnow++;
          if (
            before.familyAt(tile) === "polar-ice" &&
            after.familyAt(tile) === "alpine"
          )
            exposedRock++;
        }
        expect(unchangedInputs).toBe(true);
        expect(unchangedOutside).toBe(true);
        expect(currentSnow).toBeGreaterThan(0);
        expect(currentSnow).toBeLessThan(previousSnow * 0.6);
        expect(exposedRock).toBeGreaterThan(0);
      },
    );
  }
});
