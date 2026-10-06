import type { GameMap } from "../../core/game/GameMap";
import {
  boundsOverlap,
  buildingGroundBounds,
  buildingReservationBounds,
} from "../BuildingFootprint";
import type { LandPaths } from "../Pathfinding";
import type { BuildingType } from "../Protocol";

/** Shared spawn validation and deployment; leave legal room for a paid barracks. */
export function startingCamp(
  map: GameMap,
  paths: Pick<LandPaths, "walkable">,
  base: number,
  radius: number,
) {
  const x = map.x(base),
    y = map.y(base);
  const fits = (dx: number, dy: number, type: BuildingType) => {
    if (!map.isValidCoord(x + dx, y + dy)) return undefined;
    const tile = map.ref(x + dx, y + dy),
      bounds = buildingGroundBounds(map, tile, type);
    for (let yy = bounds.top; yy < bounds.bottom; yy++)
      for (let xx = bounds.left; xx < bounds.right; xx++)
        if (
          !map.isValidCoord(xx, yy) ||
          (xx - x) ** 2 + (yy - y) ** 2 > radius ** 2 ||
          !paths.walkable(map.ref(xx, yy))
        )
          return undefined;
    return tile;
  };
  // The usual plan is deliberately off-centre, leaving the other half of the camp.
  for (const [cx, cy, bx, by] of [
    [-3, -2, 3, -1],
    [-2, -3, -1, 3],
    [-1, -2, -6, -1],
    [-2, -1, -1, -6],
  ]) {
    const city = fits(cx, cy, "city"),
      barracks = fits(bx, by, "barracks");
    if (city !== undefined && barracks !== undefined) return { city, barracks };
  }
  const cities: number[] = [],
    barracks: number[] = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const city = fits(dx, dy, "city"),
        military = fits(dx, dy, "barracks");
      if (city !== undefined) cities.push(city);
      if (military !== undefined) barracks.push(military);
    }
  for (const city of cities)
    for (const barrack of barracks)
      if (
        !boundsOverlap(
          buildingReservationBounds(map, city, "city"),
          buildingReservationBounds(map, barrack, "barracks"),
        )
      )
        return { city, barracks: barrack };
  return undefined;
}
