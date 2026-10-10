import { BLACK_FOREST_THEME } from "./content/BlackForest";
import { createRegionalTopography, type Landform } from "./RegionalTopography";
import { erodeTerrainSlopes } from "./TerrainErosion";
import { formTerrain } from "./TerrainFormation";

export function blackForestTopography(
  size: number,
  seed: number,
): {
  heights: Float32Array;
  landforms: readonly Landform[];
} {
  const regional = createRegionalTopography(
      size,
      seed,
      BLACK_FOREST_THEME.topography,
    ),
    heights = new Float32Array(size * size),
    land = new Uint8Array(size * size).fill(1),
    shore = new Float32Array(size * size).fill(size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      heights[y * size + x] = regional.heightAt(x + 0.5, y + 0.5, size);
  // Hill ranges are regional structure, never mountain terrain classes. Dry
  // tributaries leave land intact; clearing ponds are authored separately later.
  formTerrain(
    size,
    land,
    heights,
    shore,
    regional.features,
    seed,
    BLACK_FOREST_THEME.formation,
  );
  erodeTerrainSlopes(size, land, heights, BLACK_FOREST_THEME.thermalErosion);
  return { heights, landforms: regional.features };
}
