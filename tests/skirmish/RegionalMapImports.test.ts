import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeHeightmap } from "../../src/skirmish/HeightmapMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { Skirmish } from "../../src/skirmish/Simulation";
import { LOBBY_MAPS } from "../../src/skirmish/client/lobby/MapCatalog";

function load(id: string, size: number) {
  const root = `resources/maps/${id}`;
  const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, "utf8"));
  const heights = fs.readFileSync(`${root}/${size}.heights.f32`);
  return {
    manifest,
    loaded: decodeHeightmap(
      manifest,
      size,
      new Uint8Array(fs.readFileSync(`${root}/${size}.terrain.bin`)),
      heights.buffer.slice(
        heights.byteOffset,
        heights.byteOffset + heights.length,
      ),
      new Uint8Array(fs.readFileSync(`${root}/${size}.environment.bin`)),
    ),
  };
}

describe("Down Unda, updated Old World and Middle East imports", () => {
  for (const id of ["down-unda", "old-world", "middle-east"]) {
    it(`${id} loads every size with navigable inland water and land-only biome fields`, () => {
      for (const size of [250, 500, 1000]) {
        const { manifest, loaded } = load(id, size);
        const { map, elevation, environmentData } = loaded;
        const landPaths = new LandPaths(map, false),
          waterPaths = new WaterPaths(map);
        expect(map.width()).toBe(size);
        expect(map.height()).toBe(
          id === "old-world" ? Math.round(size * 0.75) : size,
        );
        expect(manifest.environment.source.registration).toBe("same-footprint");
        expect(manifest.hydrology.variants[size].newWaterCells).toBeGreaterThan(
          100,
        );
        let valid = true,
          inlandWater = 0;
        for (let tile = 0; tile < loaded.terrain.length; tile++) {
          const height = elevation!.values[tile];
          valid &&=
            Number.isFinite(height) &&
            height >= manifest.minimum &&
            height <= manifest.maximum;
          if (map.isLand(tile)) valid &&= height > 0;
          else {
            valid &&= environmentData!.vegetation[tile] === 0;
            valid &&= waterPaths.walkable(tile) && !landPaths.walkable(tile);
            if (height > 0) inlandWater++;
          }
        }
        expect(valid).toBe(true);
        expect(inlandWater).toBeGreaterThan(100);
        for (const [name, count] of Object.entries(
          manifest.lakes.variants[size].cellsByLake,
        )) {
          if (Number(count) === 0) continue; // Subcell lakes can disappear at continental sizes.
          const level = manifest.lakes.surfaceElevationsMeters[name];
          const surfaceCells = elevation!.values.reduce(
            (total, height, tile) =>
              total + Number(height === level && map.isWater(tile)),
            0,
          );
          expect(surfaceCells).toBeGreaterThanOrEqual(Number(count));
        }
      }
    });

    it(`${id} supports twenty faction starts and has a registered preview`, () => {
      const { loaded } = load(id, 250);
      const match = new Skirmish(loaded.map, {
        ruleset: "ages-v1",
        aiCount: 14,
        humanNames: Array.from({ length: 6 }, (_, i) => `Human ${i + 1}`),
        tribes: false,
        runAi: false,
        seed: 42,
      });
      expect(match.players).toHaveLength(20);
      expect(
        match.players.every((player) => loaded.map.isLand(player.base)),
      ).toBe(true);
      match.step();
      expect(match.tick).toBe(1);
      expect(LOBBY_MAPS.find((map) => map.id === id)?.image).toBe(
        `/maps/${id}/lobby-preview.png`,
      );
      expect(
        fs
          .readFileSync(`resources/maps/${id}/lobby-preview.png`)
          .subarray(0, 8),
      ).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    });
  }
});
