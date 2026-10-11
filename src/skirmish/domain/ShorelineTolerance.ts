import type { GameMap } from "../../core/game/GameMap";
import { FIXED } from "../Protocol";
type Point = { x: number; y: number };
function clip(
  poly: readonly Point[],
  axis: "x" | "y",
  value: number,
  above: boolean,
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      ia = above ? a[axis] >= value : a[axis] <= value,
      ib = above ? b[axis] >= value : b[axis] <= value;
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}
function area(poly: readonly Point[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}
/** Exact coverage by nearby land rectangles expanded in L-infinity distance.
 * Only the occupied water intersection is tested; deep water cannot pass merely
 * because a formation is thinner than one tile. Work is bounded per water cell. */
export function withinShoreline(
  map: GameMap,
  polygon: readonly Point[],
  x: number,
  y: number,
  depth: number,
): boolean {
  if (depth <= 0) return false;
  let intersection = clip(
    clip(
      clip(clip(polygon, "x", x * FIXED, true), "x", (x + 1) * FIXED, false),
      "y",
      y * FIXED,
      true,
    ),
    "y",
    (y + 1) * FIXED,
    false,
  );
  let pieces: Point[][] = area(intersection) > 0.01 ? [intersection] : [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || !map.isValidCoord(x + dx, y + dy)) continue;
      const tile = map.ref(x + dx, y + dy);
      if (!map.isLand(tile) || map.isImpassable(tile)) continue;
      const bounds: ["x" | "y", number, boolean][] = [
        ["x", (x + dx) * FIXED - depth, true],
        ["x", (x + dx + 1) * FIXED + depth, false],
        ["y", (y + dy) * FIXED - depth, true],
        ["y", (y + dy + 1) * FIXED + depth, false],
      ];
      const rest: Point[][] = [];
      for (const piece of pieces) {
        let inside = piece;
        for (const [axis, value, above] of bounds) {
          const outside = clip(inside, axis, value, !above);
          if (area(outside) > 0.01) rest.push(outside);
          inside = clip(inside, axis, value, above);
          if (!inside.length) break;
        }
      }
      pieces = rest;
      if (!pieces.length) return true;
      if (pieces.length > 128) return false;
    }
  return !pieces.length;
}
