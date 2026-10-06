import type { GameMap } from "../../core/game/GameMap";
import { buildingFootprint } from "../BuildingFootprint";

/** Port art has water on its bottom edge. Face the longest usable shoreline.
 * Ties prefer the authored south-facing pose, then east, north, and west.
 * This is cosmetic: berth selection and authoritative geometry are independent.
 */
export function portShoreRotation(map: GameMap, tile: number): number {
  const x = map.x(tile),
    y = map.y(tile);
  const { width, height } = buildingFootprint("port");
  const water = (xx: number, yy: number): number => {
    if (!map.isValidCoord(xx, yy)) return 0;
    const cell = map.ref(xx, yy);
    return map.isWater(cell) && !map.isImpassable(cell) ? 1 : 0;
  };
  let south = 0,
    east = 0,
    north = 0,
    west = 0;
  for (let dx = 0; dx < width; dx++) {
    south += water(x + dx, y + height);
    north += water(x + dx, y - 1);
  }
  for (let dy = 0; dy < height; dy++) {
    east += water(x + width, y + dy);
    west += water(x - 1, y + dy);
  }
  const scores = [south, east, north, west];
  const rotations = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  let side = 0;
  for (let i = 1; i < scores.length; i++)
    if (scores[i] > scores[side]) side = i;
  return rotations[side];
}
