import type { GameMap } from "../core/game/GameMap";
import type { Landform } from "./RegionalTopography";
import {
  RESOURCE_SUITABILITY_ORDER,
  type ResourceTerrainData,
} from "./ResourceTerrain";
import { terrainNoise } from "./TerrainNoise";

export interface ResourceGeographyInputs {
  theme: "migration" | "black-forest";
  seed: number;
  heights: Float32Array;
  cover: Uint8Array;
  moisture: Uint8Array;
  landforms?: readonly Landform[];
}

/** Geography is baked once into immutable map inputs, shared by workers and server.
 * These are gameplay provinces, not a geological simulation. Gunpowder suitability
 * represents its raw-material sites under the existing abstract resource contract.
 */
export function addResourceGeography(
  map: GameMap,
  biomes: ResourceTerrainData,
  inputs: ResourceGeographyInputs,
): ResourceTerrainData {
  const width = map.width(),
    height = map.height(),
    count = width * height;
  if (
    [inputs.heights, inputs.cover, inputs.moisture].some(
      (a) => a.length !== count,
    )
  )
    throw new Error("Invalid resource geography inputs");
  const suitability = new Uint8Array(count * RESOURCE_SUITABILITY_ORDER.length),
    marine = new Uint8Array(count),
    migration = inputs.theme === "migration",
    offsetX = (inputs.seed & 65535) + 317,
    offsetY = (inputs.seed >>> 16) + 719;
  const basins = inputs.landforms?.filter((f) => f.kind === "basin") ?? [];
  // Mineral provinces vary at broad regional scales in normalized map space.
  // A fixed coarse grid preserves that scale across map resolutions and bounds
  // expensive noise/landform evaluation; final cover and slopes remain per tile.
  const cells = 128,
    stride = cells + 1,
    provinces = new Float32Array(stride * stride * 8),
    sample = new Float64Array(8),
    weights = new Float64Array(8);
  for (let y = 0; y <= cells; y++)
    for (let x = 0; x <= cells; x++) {
      const nx = x / cells,
        ny = y / cells,
        at = (y * stride + x) * 8;
      let basin = 0;
      for (const feature of basins) {
        const centre = feature.points[0],
          dx = nx - centre.x,
          dy = ny - centre.y,
          u =
            (dx * Math.cos(feature.angle) + dy * Math.sin(feature.angle)) /
            feature.width,
          v =
            (-dx * Math.sin(feature.angle) + dy * Math.cos(feature.angle)) /
            (feature.width * feature.aspect);
        basin = Math.max(basin, Math.exp(-(u * u + v * v) * 1.5));
      }
      provinces[at] = basin;
      for (let i = 1; i < 8; i++) {
        const broad = terrainNoise(
            nx * 1000 + offsetX + i * 1471,
            ny * 1000 + offsetY - i * 937,
            105,
          ),
          local = terrainNoise(
            nx * 1000 + offsetX - i * 811,
            ny * 1000 + offsetY + i * 1237,
            27,
          );
        provinces[at + i] = (broad * 0.8 + local * 0.2) ** 3;
      }
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const tile = y * width + x,
        elevation = inputs.heights[tile];
      marine[tile] = Number(migration && map.isWater(tile) && elevation <= 0);
      if (!map.isLand(tile) || map.isImpassable(tile)) continue;
      const nx = x / width,
        ny = y / height,
        woods = inputs.cover[tile] / 255,
        rain = inputs.moisture[tile] / 255,
        relief = Math.max(
          0,
          Math.min(1, migration ? elevation / 2300 : (elevation - 160) / 180),
        ),
        slope = Math.min(
          1,
          (Math.hypot(
            inputs.heights[y * width + Math.min(width - 1, x + 1)] -
              inputs.heights[y * width + Math.max(0, x - 1)],
            inputs.heights[Math.min(height - 1, y + 1) * width + x] -
              inputs.heights[Math.max(0, y - 1) * width + x],
          ) *
            width) /
            (migration ? 100000 : 18000),
        ),
        pasture = (1 - woods) ** 3 * (1 - relief * 0.75) * (1 - slope * 0.7);
      const gx = nx * cells,
        gy = ny * cells,
        ix = Math.floor(gx),
        iy = Math.floor(gy),
        u = gx - ix,
        v = gy - iy,
        at = (iy * stride + ix) * 8;
      for (let i = 0; i < 8; i++)
        sample[i] =
          (provinces[at + i] * (1 - u) + provinces[at + 8 + i] * u) * (1 - v) +
          (provinces[at + stride * 8 + i] * (1 - u) +
            provinces[at + (stride + 1) * 8 + i] * u) *
            v;
      const ore = 0.15 + relief * 0.65 + slope * 0.5,
        sediment = Math.max(sample[0], (1 - relief) * rain * 0.65);
      weights[0] = 1 + 45 * pasture;
      weights[1] = 2 + 22 * (relief + slope) * sample[1];
      weights[2] = 1 + 70 * ore * sample[2];
      weights[3] = 1 + 80 * ore * sample[3];
      weights[4] = 1 + 65 * ore * sample[4];
      weights[5] = 1 + 55 * sediment * sample[5];
      weights[6] = 1 + 28 * (1 - relief) * (0.3 + rain * 0.7) * sample[6];
      weights[7] = 1 + 65 * sediment * sample[7];
      for (let i = 0; i < weights.length; i++)
        suitability[tile * weights.length + i] = Math.max(
          1,
          Math.min(255, Math.round(weights[i])),
        );
    }
  return { ...biomes, suitability, marine };
}
