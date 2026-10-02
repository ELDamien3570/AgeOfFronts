import type { WorldPoint } from "../SpatialGrid";
import { distanceSquared } from "../SquadGeometry";
import { FIXED } from "../Protocol";
import type { Fortifications } from "./Fortifications";

// Both order planning and combat use the actual weapon range and target
// footprint. The target itself may block movement; other hostile cells block
// the shot. A wall span can be attacked at any exposed cell.
export function structureAim(
  from: WorldPoint, tiles: readonly number[], range: number,
  owner: number, width: number, forts: Fortifications,
): WorldPoint | undefined {
  const footprint = new Set(tiles);
  let best: WorldPoint | undefined, bestDistance = Infinity;
  for (const tile of tiles) {
    const point = { x: ((tile % width) + 0.5) * FIXED, y: (Math.floor(tile / width) + 0.5) * FIXED },
      distance = distanceSquared(from, point);
    if (distance > range ** 2 || distance >= bestDistance) continue;
    if (forts.segmentTiles(from, point).some(t => !footprint.has(t) && forts.blocked(t, owner))) continue;
    best = point;
    bestDistance = distance;
  }
  return best;
}
