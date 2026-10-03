import type { GameMap } from "../core/game/GameMap";
import { FIXED, type Squad, type SquadType } from "./Protocol";
import type { WorldPoint } from "./SpatialGrid";

// Compact rows retain lanes for friendly traffic. Pair clearance, rather than
// duplicate colliders or queries, lets friendly artwork overlap while passing.
export const FORMATION_SPACING = 1.5 * FIXED;
export const COLLISION_SKIN = 2;
export const ARRIVAL_TOLERANCE = 2;
export function squadRadius(kind: SquadType): number {
  return Math.round(FIXED * (kind === "cavalry" ? 0.48 : 0.45));
}
export type SquadGeometry = Pick<Squad, "kind" | "playerId">;
export function squadSeparation(a: SquadGeometry, b: SquadGeometry): number {
  const radius = squadRadius(a.kind) + squadRadius(b.kind);
  return (
    Math.round(radius * (a.playerId === b.playerId ? 0.5 : 1)) + COLLISION_SKIN
  );
}
export function meleeContact(a: SquadType, b: SquadType): number {
  // A close resting stance leaves a little room for the visual weapon lunge.
  return squadRadius(a) + squadRadius(b) + FIXED / 4;
}

export function pointTile(map: GameMap, point: WorldPoint): number {
  return map.ref(Math.floor(point.x / FIXED), Math.floor(point.y / FIXED));
}
export function tilePoint(map: GameMap, tile: number): WorldPoint {
  return {
    x: map.x(tile) * FIXED + FIXED / 2,
    y: map.y(tile) * FIXED + FIXED / 2,
  };
}
export function distanceSquared(a: WorldPoint, b: WorldPoint): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

export function standable(
  map: GameMap,
  point: WorldPoint,
  radius: number,
): boolean {
  const left = Math.floor((point.x - radius) / FIXED);
  const right = Math.floor((point.x + radius) / FIXED);
  const top = Math.floor((point.y - radius) / FIXED);
  const bottom = Math.floor((point.y + radius) / FIXED);
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const dx = Math.max(x * FIXED - point.x, 0, point.x - (x + 1) * FIXED);
      const dy = Math.max(y * FIXED - point.y, 0, point.y - (y + 1) * FIXED);
      if (dx * dx + dy * dy >= radius * radius) continue;
      if (!map.isValidCoord(x, y)) return false;
      const tile = map.ref(x, y);
      if (!map.isLand(tile) || map.isImpassable(tile)) return false;
    }
  return true;
}

// Exact capsule-versus-terrain checks prevent corner cutting without sampling.
export function traversable(
  map: GameMap,
  from: WorldPoint,
  to: WorldPoint,
  radius: number,
): boolean {
  if (
    Math.min(from.x, to.x) < radius ||
    Math.min(from.y, to.y) < radius ||
    Math.max(from.x, to.x) > map.width() * FIXED - radius ||
    Math.max(from.y, to.y) > map.height() * FIXED - radius
  )
    return false;
  const dx = to.x - from.x,
    dy = to.y - from.y,
    lengthSquared = dx * dx + dy * dy;
  const left = Math.floor((Math.min(from.x, to.x) - radius) / FIXED);
  const right = Math.floor((Math.max(from.x, to.x) + radius) / FIXED);
  const top = Math.floor((Math.min(from.y, to.y) - radius) / FIXED);
  const bottom = Math.floor((Math.max(from.y, to.y) + radius) / FIXED);
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      if (map.isValidCoord(x, y)) {
        const tile = map.ref(x, y);
        if (map.isLand(tile) && !map.isImpassable(tile)) continue;
      }
      const x0 = x * FIXED,
        x1 = x0 + FIXED,
        y0 = y * FIXED,
        y1 = y0 + FIXED;
      let enter = 0,
        exit = 1;
      for (const [origin, direction, low, high] of [
        [from.x, dx, x0, x1],
        [from.y, dy, y0, y1],
      ]) {
        if (!direction) {
          if (origin < low || origin > high) {
            enter = 1;
            exit = 0;
          }
        } else {
          const a = (low - origin) / direction,
            b = (high - origin) / direction;
          enter = Math.max(enter, Math.min(a, b));
          exit = Math.min(exit, Math.max(a, b));
        }
      }
      if (enter <= exit) return false;
      let minimum = Infinity;
      for (const point of [from, to]) {
        const px = Math.max(x0 - point.x, 0, point.x - x1),
          py = Math.max(y0 - point.y, 0, point.y - y1);
        minimum = Math.min(minimum, px * px + py * py);
      }
      for (const cx of [x0, x1])
        for (const cy of [y0, y1]) {
          const along = lengthSquared
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((cx - from.x) * dx + (cy - from.y) * dy) / lengthSquared,
                ),
              )
            : 0;
          minimum = Math.min(
            minimum,
            (cx - from.x - along * dx) ** 2 + (cy - from.y - along * dy) ** 2,
          );
        }
      if (minimum < radius * radius) return false;
    }
  return true;
}
