import type { GameMap } from "../../core/game/GameMap";
import { FIXED } from "../Protocol";
import type { WorldPoint } from "../SpatialGrid";
/** Twelve deterministic side/rear points, generated lazily rather than searching
 * an entire terrain square. Exact connectivity is certified separately. */
export function flankCandidate(
  map: GameMap,
  origin: WorldPoint,
  target: WorldPoint,
  index: number,
  side: -1 | 1,
): number | undefined {
  if (index < 0 || index >= 12) return undefined;
  const facing = Math.atan2(target.y - origin.y, target.x - origin.x);
  const angle = facing + side * (Math.PI / 2 + ((index % 4) * Math.PI) / 12);
  const radius = (6 + Math.floor(index / 4) * 2) * FIXED;
  const x = Math.floor((target.x + Math.cos(angle) * radius) / FIXED);
  const y = Math.floor((target.y + Math.sin(angle) * radius) / FIXED);
  return x >= 0 && y >= 0 && x < map.width() && y < map.height()
    ? map.ref(x, y)
    : undefined;
}
export function approachCandidate(
  map: GameMap,
  targetTile: number,
  range: number,
  index: number,
): number | undefined {
  if (index < 0 || index >= 24) return undefined;
  const radius = Math.max(
    1,
    Math.floor((range / FIXED) * (index < 12 ? 0.8 : 0.5)),
  );
  const angle = ((index % 12) * Math.PI) / 6;
  const x = map.x(targetTile) + Math.round(Math.cos(angle) * radius);
  const y = map.y(targetTile) + Math.round(Math.sin(angle) * radius);
  return x >= 0 && y >= 0 && x < map.width() && y < map.height()
    ? map.ref(x, y)
    : undefined;
}
