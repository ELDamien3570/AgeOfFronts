import type { GameMap } from "../core/game/GameMap";
import { buildingFootprint } from "./BuildingFootprint";

/** Every water edge of a port's occupied footprint can serve as its berth.
 * Anchor-adjacent water retains its historical priority for existing routes. */
export function portWaterTiles(map: GameMap, tile: number): number[] {
  const result: number[] = [], seen = new Set<number>(),
    shape = buildingFootprint("port"), x = map.x(tile), y = map.y(tile);
  for (let dy = 0; dy < shape.height; dy++) for (let dx = 0; dx < shape.width; dx++) {
    if (!map.isValidCoord(x + dx, y + dy)) continue;
    for (const next of map.neighbors(map.ref(x + dx, y + dy))) {
      if (map.isWater(next) && !map.isImpassable(next) && !seen.has(next)) {
        seen.add(next); result.push(next);
      }
    }
  }
  return result;
}
