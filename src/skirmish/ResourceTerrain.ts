import type { GameMap } from "../core/game/GameMap";
import type { EnvironmentProfile } from "./Environment";

/** Immutable biome inputs carried with a map into every simulation runtime. */
export interface ResourceTerrainData {
  desert: Uint8Array;
  /** Tile-major relative suitability; one byte per resource in the declared order. */
  suitability?: Uint8Array;
  /** Optional explicit marine mask. Inland ponds and rivers never host offshore oil. */
  marine?: Uint8Array;
}
export const RESOURCE_SUITABILITY_ORDER = [
  "horses",
  "stone",
  "copper",
  "tin",
  "ironOre",
  "carbon",
  "gunpowder",
  "oil",
] as const;
export function resourceTerrainData(
  map: GameMap,
  environment: EnvironmentProfile,
): ResourceTerrainData {
  const desert = new Uint8Array(map.width() * map.height());
  for (let tile = 0; tile < desert.length; tile++)
    desert[tile] = environment.familyAt(tile) === "desert-xeric" ? 1 : 0;
  return { desert };
}
export function resourceTerrainOf(
  map: GameMap,
): ResourceTerrainData | undefined {
  return (map as GameMap & { resourceTerrain?: ResourceTerrainData })
    .resourceTerrain;
}
