import { PseudoRandom } from "../core/PseudoRandom";
import { MIGRATION_THEME } from "./content/Migration";
import { createSkirmishMap } from "./Elevation";
import { ENVIRONMENT_FAMILIES, EnvironmentProfile } from "./Environment";
import { buildMigrationLayout, type MigrationLayout } from "./MigrationLayout";
import type { LoadedMap } from "./Protocol";
import { addResourceGeography } from "./ResourceGeography";
import { resourceTerrainData } from "./ResourceTerrain";
import { terrainNoise } from "./TerrainNoise";
export type { MigrationLandmass } from "./MigrationLayout";

export interface MigrationMap extends LoadedMap {
  layout: MigrationLayout;
  generation: { theme: "migration"; revision: number; seed: number };
}
/** Landforms first, with a reserved sea moat. No forced starts or special economy. */
export function generateMigration(size = 500, seed = 0): MigrationMap {
  if (
    ![250, 500, 1000].includes(size) ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0x7fffffff
  )
    throw new Error("Invalid Migration size or seed");
  const random = new PseudoRandom(seed ^ 0x29fa8371),
    count = size * size,
    terrain = new Uint8Array(count),
    cover = new Uint8Array(count),
    moisture = new Uint8Array(count),
    vegetation = new Uint8Array(count),
    aridity = new Uint8Array(count).fill(20),
    families = new Uint8Array(count),
    { layout, shore, heights } = buildMigrationLayout(
      size as 250 | 500 | 1000,
      seed,
    ),
    { regions } = layout,
    nx = random.nextInt(-10000, 10000),
    ny = random.nextInt(-10000, 10000),
    wind = random.nextFloat(0, Math.PI * 2),
    windX = Math.round(Math.cos(wind) * size * 0.018),
    windY = Math.round(Math.sin(wind) * size * 0.018);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tile = y * size + x,
        land = regions[tile] !== 0,
        slope =
          (Math.hypot(
            heights[y * size + Math.min(size - 1, x + 1)] -
              heights[y * size + Math.max(0, x - 1)],
            heights[Math.min(size - 1, y + 1) * size + x] -
              heights[Math.max(0, y - 1) * size + x],
          ) *
            size) /
          1000,
        mountain =
          land &&
          regions[tile] <= layout.mainlands.length &&
          heights[tile] >= MIGRATION_THEME.mountainMinimumHeight &&
          slope >= MIGRATION_THEME.mountainMinimumSlope &&
          shore[tile] >= MIGRATION_THEME.mountainMinimumShoreDistance,
        broad = terrainNoise(x + nx, y + ny, Math.max(12, size / 20)),
        upwind = Math.max(
          0,
          heights[
            Math.max(0, Math.min(size - 1, y - windY)) * size +
              Math.max(0, Math.min(size - 1, x - windX))
          ],
        ),
        rain = Math.max(
          0.12,
          Math.min(
            0.95,
            0.62 +
              (broad - 0.5) * 0.35 +
              Math.max(0, heights[tile] - upwind) / 5000 -
              Math.max(0, upwind - heights[tile]) / 3500,
          ),
        ),
        growing = Math.max(
          0,
          Math.min(1, 1 - Math.max(0, heights[tile] - 1100) / 3000),
        ),
        woodland =
          Math.max(0, Math.min(1, (broad - 0.44) * 4)) *
          Math.min(1, shore[tile] / 5) *
          growing *
          Math.min(1, rain * 1.6);
      // Elevation alone never makes a plateau impassable. Traversable hills
      // follow slope; steep ridges retain the reserved-island constraint above.
      terrain[tile] = mountain
        ? 159
        : land
          ? slope > 32 && heights[tile] > 900
            ? 153
            : slope > 14 && heights[tile] > 250
              ? 143
              : 133
          : 1;
      cover[tile] = land && !mountain ? Math.round(woodland * 240) : 0;
      moisture[tile] = land ? Math.round(rain * 255) : 255;
      aridity[tile] = land ? Math.round((1 - rain) * 160) : 0;
      vegetation[tile] = mountain
        ? 25
        : land
          ? Math.round((80 + rain * 90 + woodland * 80) * growing)
          : 0;
      families[tile] = ENVIRONMENT_FAMILIES.indexOf(
        mountain || (land && heights[tile] > 2300)
          ? "alpine"
          : !land || shore[tile] < 3
            ? "coastal"
            : woodland > 0.3
              ? "temperate-woodland"
              : "grassland-steppe",
      );
    }
  const elevation = {
      values: heights,
      minimum: -4500,
      maximum: 6000,
      seaLevel: 0,
      reliefScale: (5 * size) / 1000,
    },
    forest = { cover },
    environmentData = { moisture, vegetation, aridity, families },
    bare = createSkirmishMap(size, size, terrain, elevation, forest),
    environment = new EnvironmentProfile(bare, undefined, [], environmentData),
    resources = addResourceGeography(
      bare,
      resourceTerrainData(bare, environment),
      {
        theme: "migration",
        seed,
        heights,
        cover,
        moisture,
        landforms: layout.landforms,
      },
    ),
    map = createSkirmishMap(size, size, terrain, elevation, forest, resources);
  return {
    map,
    terrain,
    elevation,
    forest,
    environmentData,
    environment,
    resourceTerrain: resources,
    layout,
    generation: {
      theme: "migration",
      revision: MIGRATION_THEME.revision,
      seed,
    },
    name: `Migration · ${size}×${size} · seed ${seed}`,
    territoryIncomeScale: Math.max(1, count / (250 * 125)),
  };
}
