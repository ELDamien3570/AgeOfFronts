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
import { addResourceGeography } from "./ResourceGeography";
import { terrainNoise } from "./TerrainNoise";

export type BlackForestPondMode = "dry" | "half" | "near-all";
export interface ForestPond {
  clearingId: number;
  x: number;
  y: number;
  tiles: readonly number[];
}

export interface BlackForestMap extends LoadedMap {
  ponds: readonly ForestPond[];
  layout: BlackForestLayout;
  generation: {
    theme: "black-forest";
    revision: number;
    seed: number;
    pondMode: BlackForestPondMode;
  };
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
  // Water coverage has its own random stream, independent of shape sampling.
  const waterRandom = new PseudoRandom(seed ^ 0x62bd1739),
    modeIndex = waterRandom.nextInt(0, BLACK_FOREST_THEME.pondCoverage.length),
    pondMode = (["dry", "half", "near-all"] as const)[modeIndex],
    targetCount = Math.round(
      layout.clearings.length * BLACK_FOREST_THEME.pondCoverage[modeIndex],
    ),
    ponds: ForestPond[] = [];
  for (const clearing of waterRandom.shuffleArray(layout.clearings.slice())) {
    if (ponds.length >= targetCount) break;
    const extent = Math.max(clearing.radiusX, clearing.radiusY) * 1.4,
      phase = waterRandom.nextFloat(0, Math.PI * 2);
    const tryPond = (
      x: number,
      y: number,
      radius: number,
    ): number[] | undefined => {
      const centreDistance = Math.hypot(x - clearing.x, y - clearing.y);
      if (
        layout.clearings.some(
          (c) =>
            c.id !== clearing.id &&
            Math.hypot(x - c.x, y - c.y) < centreDistance,
        )
      )
        return;
      const tiles: number[] = [];
      for (
        let yy = Math.floor(y - radius * 1.5);
        yy <= Math.ceil(y + radius * 1.5);
        yy++
      )
        for (
          let xx = Math.floor(x - radius * 1.5);
          xx <= Math.ceil(x + radius * 1.5);
          xx++
        ) {
          const dx = xx + 0.5 - x,
            dy = yy + 0.5 - y,
            angle = Math.atan2(dy, dx),
            boundary =
              radius *
              (1 +
                0.16 * Math.sin(angle * 3 + phase) +
                0.1 * Math.sin(angle * 5 - phase));
          if (Math.hypot(dx, dy) > boundary) continue;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) return;
          const tile = yy * size + xx;
          // Keep the complete shoreline in open ground and leave routes and settlement centres dry.
          if (
            layout.clearance[tile] <
              BLACK_FOREST_THEME.forestEdgeWidth / 2 + 1 ||
            layout.passageClearance[tile] > -1 ||
            terrain[tile] === 1 ||
            layout.clearings.some(
              (c) => Math.hypot(xx + 0.5 - c.x, yy + 0.5 - c.y) < 7,
            )
          )
            return;
          tiles.push(tile);
        }
      return tiles.length >= 12 ? tiles : undefined;
    };
    let pond: ForestPond | undefined;
    for (let attempt = 0; attempt < 100 && !pond; attempt++) {
      const x = clearing.x + waterRandom.nextFloat(-extent, extent),
        y = clearing.y + waterRandom.nextFloat(-extent, extent),
        radius = waterRandom.nextFloat(2.5, 4.6),
        tiles = tryPond(x, y, radius);
      if (tiles) pond = { clearingId: clearing.id, x, y, tiles };
    }
    // A bounded scan finds a smaller pocket when a glade has several broad route entrances.
    for (
      let y = Math.floor(clearing.y - extent);
      y <= clearing.y + extent && !pond;
      y += 2
    )
      for (
        let x = Math.floor(clearing.x - extent);
        x <= clearing.x + extent && !pond;
        x += 2
      ) {
        const tiles = tryPond(x + 0.5, y + 0.5, 2.3);
        if (tiles)
          pond = { clearingId: clearing.id, x: x + 0.5, y: y + 0.5, tiles };
      }
    if (!pond) continue;
    const centre = Math.floor(pond.y) * size + Math.floor(pond.x),
      bed = heights[centre] - 3;
    for (const tile of pond.tiles) {
      terrain[tile] = 1;
      heights[tile] = bed;
      cover[tile] = 0;
      vegetation[tile] = 0;
    }
    ponds.push(pond);
  }
  const elevation = { values: heights, minimum: 0, maximum: 500, seaLevel: 0 },
    forest = { cover },
    environmentData = { moisture, vegetation, aridity, families },
    bare = createSkirmishMap(size, size, terrain, elevation, forest),
    environment = new EnvironmentProfile(bare, undefined, [], environmentData),
    resources = addResourceGeography(bare, resourceTerrainData(bare, environment), {
      theme: "black-forest", seed, heights, cover, moisture,
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
    ponds,
    generation: {
      theme: "black-forest",
      revision: BLACK_FOREST_THEME.revision,
      seed,
      pondMode,
    },
    name: `Black Forest · ${size}×${size} · seed ${seed}`,
    territoryIncomeScale: Math.max(1, count / (250 * 125)),
  };
}
