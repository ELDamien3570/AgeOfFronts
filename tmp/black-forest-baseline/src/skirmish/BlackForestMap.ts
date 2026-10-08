import { PseudoRandom } from "../core/PseudoRandom";
import {
  BLACK_FOREST_THEME,
  blackForestLayout,
  type BlackForestLayout,
} from "./BlackForestLayout";
import { createSkirmishMap } from "./Elevation";
import { ENVIRONMENT_FAMILIES, EnvironmentProfile } from "./Environment";
import type { LoadedMap } from "./Protocol";
import { resourceTerrainData } from "./ResourceTerrain";
import { terrainNoise } from "./TerrainNoise";

export interface BlackForestMap extends LoadedMap {
  layout: BlackForestLayout;
  generation: { theme: "black-forest"; revision: number; seed: number };
}

/** Dense woods remain traversable: the existing cover field owns movement costs. */
export function generateBlackForest(size = 500, seed = 0): BlackForestMap {
  const layout = blackForestLayout(size, seed),
    count = size * size,
    terrain = new Uint8Array(count).fill(133),
    heights = new Float32Array(count),
    cover = new Uint8Array(count),
    moisture = new Uint8Array(count),
    vegetation = new Uint8Array(count),
    aridity = new Uint8Array(count).fill(12),
    families = new Uint8Array(count),
    random = new PseudoRandom(seed ^ 0x2b573c21),
    nx = random.nextInt(-10000, 10000),
    ny = random.nextInt(-10000, 10000),
    woodland = ENVIRONMENT_FAMILIES.indexOf(BLACK_FOREST_THEME.woodlandFamily),
    meadow = ENVIRONMENT_FAMILIES.indexOf(BLACK_FOREST_THEME.clearingFamily);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tile = y * size + x,
        distance = layout.clearance[tile],
        noise = terrainNoise(x + nx, y + ny, 24),
        edge = Math.max(
          0,
          Math.min(
            1,
            (BLACK_FOREST_THEME.forestEdgeWidth / 2 - distance) /
              BLACK_FOREST_THEME.forestEdgeWidth,
          ),
        );
      cover[tile] = Math.round(
        edge *
          (BLACK_FOREST_THEME.minimumForestCover +
            noise *
              (BLACK_FOREST_THEME.maximumForestCover -
                BLACK_FOREST_THEME.minimumForestCover)),
      );
      families[tile] = edge > 0.2 ? woodland : meadow;
      moisture[tile] = Math.round(150 + edge * 65);
      vegetation[tile] = Math.round(100 + edge * 140);
      heights[tile] =
        100 + noise * 180 + terrainNoise(x + nx, y + ny, 71) * 100;
    }
  // Small woodland ponds sit outside the authored clearings and main routes.
  // Their water bed retains the local inland elevation, like existing river maps.
  const ponds = Math.max(
    3,
    Math.round(layout.clearings.length * BLACK_FOREST_THEME.pondsPerClearing),
  );
  for (
    let index = 0, placed = 0;
    index < ponds * 40 && placed < ponds;
    index++
  ) {
    const x = random.nextInt(15, size - 15),
      y = random.nextInt(15, size - 15),
      radius = random.nextFloat(2.8, 5.2);
    if (layout.clearance[y * size + x] > -radius - 5) continue;
    const bed = heights[y * size + x] - 3;
    for (let yy = Math.floor(y - radius); yy <= Math.ceil(y + radius); yy++)
      for (
        let xx = Math.floor(x - radius * 1.4);
        xx <= Math.ceil(x + radius * 1.4);
        xx++
      ) {
        const distance = Math.hypot((xx - x) / 1.4, yy - y);
        if (distance > radius || xx < 0 || yy < 0 || xx >= size || yy >= size)
          continue;
        const tile = yy * size + xx;
        terrain[tile] = 1;
        heights[tile] = bed;
        cover[tile] = 0;
        vegetation[tile] = 0;
      }
    placed++;
  }
  const elevation = { values: heights, minimum: 0, maximum: 500, seaLevel: 0 },
    forest = { cover },
    environmentData = { moisture, vegetation, aridity, families },
    bare = createSkirmishMap(size, size, terrain, elevation, forest),
    environment = new EnvironmentProfile(bare, undefined, [], environmentData),
    resources = resourceTerrainData(bare, environment),
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
      theme: "black-forest",
      revision: BLACK_FOREST_THEME.revision,
      seed,
    },
    name: `Black Forest · ${size}×${size} · seed ${seed}`,
    territoryIncomeScale: Math.max(1, count / (250 * 125)),
  };
}
