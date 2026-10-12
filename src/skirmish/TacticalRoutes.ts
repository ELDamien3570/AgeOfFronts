import type { GameMap } from "../core/game/GameMap";
import type { LandPaths } from "./Pathfinding";
import type { Squad } from "./Protocol";
import { FIXED } from "./Protocol";
import { squadRadius, standable, tilePoint } from "./SquadGeometry";

function tileOf(map: GameMap, unit: Pick<Squad, "x" | "y">): number {
  return map.ref(Math.floor(unit.x / FIXED), Math.floor(unit.y / FIXED));
}

export function firingPosition(
  map: GameMap,
  paths: LandPaths,
  squad: Squad,
  target: Squad,
  range: number,
  blocked?: (tile: number) => boolean,
  clear?: (from: { x: number; y: number }, to: { x: number; y: number }) => boolean,
  rangeAt?: (point:{x:number;y:number})=>number,
  heightScore?: (point:{x:number;y:number})=>number,
): number | null {
  const origin = tileOf(map, squad);
  const radius = Math.ceil(range / FIXED);
  const tx = Math.floor(target.x / FIXED),
    ty = Math.floor(target.y / FIXED);
  let best: number | null = null,
    score = Infinity;
  for (
    let y = Math.max(0, ty - radius);
    y <= Math.min(map.height() - 1, ty + radius);
    y++
  )
    for (
      let x = Math.max(0, tx - radius);
      x <= Math.min(map.width() - 1, tx + radius);
      x++
    ) {
      const tile = map.ref(x, y);
      const point = tilePoint(map, tile);
      if (!paths.connected(origin, tile) || blocked?.(tile) ||
        !standable(map, point, squadRadius(squad.kind)) ||
        (clear && !clear(point, target))) continue;
      const dx = x * FIXED + FIXED / 2 - target.x,
        dy = y * FIXED + FIXED / 2 - target.y;
      const distance = dx * dx + dy * dy;
      const exactRange=rangeAt?.(point)??range;
      if (distance > exactRange * exactRange) continue;
      const outerBand = distance >= (exactRange - FIXED / 2) ** 2;
      const gap = exactRange * exactRange - distance;
      const approach = map.manhattanDist(origin, tile);
      const candidate = (outerBand ? approach : 100000 + gap * 100 + approach)-(heightScore?.(point)??0);
      if (candidate < score) {
        best = tile;
        score = candidate;
      }
    }
  return best;
}
