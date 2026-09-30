import manifest from "../../../Art/Terrain/Earth/manifest.json";

import { ENVIRONMENT_FAMILIES, type EnvironmentFamily } from "../Environment";

export const TERRAIN_FAMILIES = ENVIRONMENT_FAMILIES;
export type TerrainFamily = EnvironmentFamily;
export interface TerrainAccent {
  id: string;
  family: TerrainFamily;
  role: string;
  sourceRect: readonly number[];
  alphaBounds: readonly number[];
  pivot: readonly number[];
  visibleFootprintCells: number;
  imageSizeCells: readonly number[];
}

// Semantic IDs and authored bounds are the contract; PNG colour never supplies
// biome, movement, or collision data. Only the approved manifest is consumed.
export const EARTH_ACCENTS: readonly TerrainAccent[] = manifest.atlases.flatMap(
  (atlas) =>
    atlas.slots.map((slot) => ({ ...slot, family: atlas.id as TerrainFamily })),
);
export const FAMILY_ACCENTS = new Map<TerrainFamily, readonly TerrainAccent[]>(
  TERRAIN_FAMILIES.map((family) => [
    family,
    EARTH_ACCENTS.filter((slot) => slot.family === family),
  ]),
);
export const FAMILY_COLORS = new Map<TerrainFamily, readonly number[]>(
  manifest.atlases.map((atlas) => [
    atlas.id as TerrainFamily,
    [1, 3, 5].map((offset) =>
      parseInt(atlas.groundPreview.slice(offset, offset + 2), 16),
    ),
  ]),
);
