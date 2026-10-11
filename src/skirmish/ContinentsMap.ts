import { PseudoRandom } from "../core/PseudoRandom";
import { CONTINENTS_THEME as THEME } from "./content/Continents";
import { buildContinentsLayout, type ContinentsLayout } from "./ContinentsLayout";
import { createSkirmishMap } from "./Elevation";
import {
  ENVIRONMENT_FAMILIES,
  EnvironmentProfile,
  type EnvironmentFamily,
} from "./Environment";
import type { LoadedMap } from "./Protocol";
import { addResourceGeography } from "./ResourceGeography";
import { resourceTerrainData } from "./ResourceTerrain";
import { terrainNoise } from "./TerrainNoise";

export interface ContinentsMap extends LoadedMap {
  layout: ContinentsLayout;
  generation: { theme: "continents"; revision: number; seed: number };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
/** Share of a family's land that carries woodland before the continent's density. */
const WOODLAND: Partial<Record<EnvironmentFamily, number>> = {
  "tropical-moist": 1,
  "boreal-conifer": 0.9,
  "temperate-woodland": 0.8,
  "wetland-riparian": 0.6,
  "mediterranean-scrub": 0.35,
  "savanna-dry-woodland": 0.3,
  "grassland-steppe": 0.15,
  tundra: 0.05,
};

/** Whittaker-style biome: temperature 0 = polar, 1 = tropical; moisture 0 = arid. */
function biome(temperature: number, moisture: number): EnvironmentFamily {
  if (temperature < 0.07) return "polar-ice";
  if (temperature < 0.17) return "tundra";
  if (temperature < 0.36)
    return moisture > 0.42 ? "boreal-conifer" : moisture > 0.24 ? "grassland-steppe" : "tundra";
  if (temperature > 0.62) {
    if (moisture < 0.22) return "desert-xeric";
    if (moisture < 0.6) return "savanna-dry-woodland";
    return "tropical-moist";
  }
  if (moisture < 0.2) return "desert-xeric";
  if (moisture < 0.34) return temperature > 0.5 ? "mediterranean-scrub" : "grassland-steppe";
  return moisture < 0.5 ? "grassland-steppe" : "temperate-woodland";
}

/** Earth-like continents: scaled count, per-continent climate, relief and forest. */
export function generateContinents(size = 500, seed = 0): ContinentsMap {
  if (
    ![250, 500, 1000, 2000].includes(size) ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0x7fffffff
  )
    throw new Error("Invalid Continents size or seed");
  const random = new PseudoRandom(seed ^ 0x6b2d7e15),
    count = size * size,
    terrain = new Uint8Array(count),
    cover = new Uint8Array(count),
    moisture = new Uint8Array(count),
    vegetation = new Uint8Array(count),
    aridity = new Uint8Array(count).fill(20),
    families = new Uint8Array(count),
    { layout, shore, heights } = buildContinentsLayout(size as 250 | 500 | 1000 | 2000, seed),
    { regions, profiles, continentCount } = layout,
    nx = random.nextInt(-10000, 10000),
    ny = random.nextInt(-10000, 10000),
    wind = random.nextFloat(0, Math.PI * 2),
    windX = Math.round(Math.cos(wind) * size * 0.018),
    windY = Math.round(Math.sin(wind) * size * 0.018);
  // Islands share the climate of the nearest continent.
  const owner = (id: number, x: number, y: number) => {
    if (id >= 1 && id <= continentCount) return profiles[id - 1];
    let nearest = profiles[0],
      distance = Infinity;
    for (const profile of profiles) {
      const body = layout.mainlands[profile.id - 1],
        d = Math.hypot(x - body.x, y - body.y);
      if (d < distance) {
        distance = d;
        nearest = profile;
      }
    }
    return nearest;
  };
  const owners = new Map<number, ReturnType<typeof owner>>();
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tile = y * size + x,
        id = regions[tile],
        land = id !== 0,
        h = heights[tile];
      if (!land) {
        terrain[tile] = 1;
        moisture[tile] = 255;
        families[tile] = ENVIRONMENT_FAMILIES.indexOf("coastal");
        continue;
      }
      let profile = owners.get(id);
      if (!profile) {
        profile = owner(id, x, y);
        owners.set(id, profile);
      }
      const slope =
          (Math.hypot(
            heights[y * size + Math.min(size - 1, x + 1)] -
              heights[y * size + Math.max(0, x - 1)],
            heights[Math.min(size - 1, y + 1) * size + x] -
              heights[Math.max(0, y - 1) * size + x],
          ) *
            size) /
          1000,
        mountain =
          id <= continentCount &&
          h >= THEME.mountainMinimumHeight &&
          slope >= THEME.mountainMinimumSlope &&
          shore[tile] >= THEME.mountainMinimumShoreDistance,
        broad = terrainNoise(x + nx, y + ny, Math.max(12, size / 20)),
        upwind = Math.max(
          0,
          heights[
            Math.max(0, Math.min(size - 1, y - windY)) * size +
              Math.max(0, Math.min(size - 1, x - windX))
          ],
        ),
        equator = 1 - Math.abs((2 * (y + 0.5)) / size - 1),
        temperature = clamp01(
          profile.temperature +
            (equator - profile.equatorial) * THEME.latitudeSpread -
            Math.max(0, h - 500) * 0.00009 +
            (terrainNoise(x + nx + 311, y + ny - 97, size / 12) - 0.5) * 0.08,
        ),
        wet = clamp01(
          profile.moisture +
            (broad - 0.5) * 0.34 +
            Math.max(0, h - upwind) / 6000 -
            Math.max(0, upwind - h) / 3200 +
            0.12 * Math.max(0, 1 - shore[tile] / (size * 0.04)),
        ),
        family: EnvironmentFamily = mountain || h > 2300 ? "alpine" : biome(temperature, wet),
        growing = clamp01(1 - Math.max(0, h - 1100) / 3000),
        patch = clamp01((terrainNoise(x + nx - 733, y + ny + 129, size / 18) - 0.28 + profile.forest * 0.25) * 2.5),
        woodland =
          clamp01((WOODLAND[family] ?? 0) * (0.35 + 0.9 * profile.forest) * patch) *
          Math.min(1, shore[tile] / 5) *
          growing;
      terrain[tile] = mountain
        ? 159
        : slope > 32 && h > 900
          ? 153
          : slope > 14 && h > 250
            ? 143
            : 133;
      cover[tile] = mountain ? 0 : Math.round(woodland * 240);
      moisture[tile] = Math.round(wet * 255);
      aridity[tile] = Math.round((1 - wet) * 255);
      vegetation[tile] = mountain
        ? 25
        : Math.round(
            clamp01(0.12 + wet * 0.62 + woodland * 0.3) *
              (temperature < 0.1 ? 0.25 : 1) *
              growing *
              255,
          );
      families[tile] = ENVIRONMENT_FAMILIES.indexOf(family);
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
    resources = addResourceGeography(bare, resourceTerrainData(bare, environment), {
      theme: "continents",
      seed,
      heights,
      cover,
      moisture,
      landforms: layout.landforms,
    }),
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
    generation: { theme: "continents", revision: THEME.revision, seed },
    name: `Continents · ${size}×${size} · seed ${seed}`,
    territoryIncomeScale: Math.max(1, count / (250 * 125)),
  };
}
