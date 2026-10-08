import type { GameMap } from "../core/game/GameMap";
import type { EnvironmentProfile } from "./Environment";

/** Immutable biome inputs carried with a map into every simulation runtime. */
export interface ResourceTerrainData {
  desert: Uint8Array;
}
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
