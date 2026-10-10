import type { GameMap } from "../core/game/GameMap";
import type { LandPaths } from "./Pathfinding";
import { FIXED, type SquadType } from "./Protocol";
import type { WorldPoint } from "./SpatialGrid";
import { squadRadius, standable, tilePoint } from "./SquadGeometry";

export interface FiringPositionState {
  origin: number;
  kind: SquadType;
  target: WorldPoint;
  range: number;
  left: number;
  top: number;
  width: number;
  height: number;
  cursor: number;
  done: boolean;
  candidates: { tile: number; score: number }[];
}
/** Candidate sampling and LOS are separate bounded work, not a synchronous
 * map window hidden inside a route request. Exact routing tests finalists.
 */
export class FiringPositions {
  readonly state: FiringPositionState;
  constructor(
    private readonly map: GameMap,
    private readonly paths: LandPaths,
    origin: number,
    kind: SquadType,
    target: WorldPoint,
    range: number,
    saved?: FiringPositionState,
  ) {
    const radius = Math.ceil(range / FIXED),
      tx = Math.floor(target.x / FIXED),
      ty = Math.floor(target.y / FIXED),
      left = Math.max(0, tx - radius),
      top = Math.max(0, ty - radius),
      right = Math.min(map.width() - 1, tx + radius),
      bottom = Math.min(map.height() - 1, ty + radius);
    this.state = saved ?? {
      origin,
      kind,
      target: { ...target },
      range,
      left,
      top,
      width: right - left + 1,
      height: bottom - top + 1,
      cursor: 0,
      done: false,
      candidates: [],
    };
  }
  step(
    budget: number,
    rayBudget: number,
    blocked?: (tile: number) => boolean,
    clear?: (from: WorldPoint, to: WorldPoint) => boolean,
    standing?: (point: WorldPoint) => boolean,
  ): { work: number; rays: number } {
    const s = this.state;
    let work = 0,
      rays = 0;
    while (work < budget && s.cursor < s.width * s.height) {
      const x = s.left + (s.cursor % s.width),
        y = s.top + Math.floor(s.cursor / s.width),
        tile = this.map.ref(x, y),
        point = tilePoint(this.map, tile),
        dx = point.x - s.target.x,
        dy = point.y - s.target.y,
        distance = dx * dx + dy * dy;
      const valid =
        distance <= s.range * s.range &&
        this.paths.connected(s.origin, tile) &&
        !blocked?.(tile) &&
        standable(this.map, point, squadRadius(s.kind)) &&
        (!standing || standing(point));
      if (valid && clear && rays >= rayBudget) break;
      s.cursor++;
      work++;
      if (!valid) continue;
      if (clear) {
        rays++;
        if (!clear(point, s.target)) continue;
      }
      const approach = this.map.manhattanDist(s.origin, tile),
        outer = distance >= (s.range - FIXED / 2) ** 2,
        score = outer
          ? approach
          : 100000 + (s.range * s.range - distance) * 100 + approach;
      const candidate = { tile, score };
      const at = s.candidates.findIndex(
        (c) => c.score > score || (c.score === score && c.tile > tile),
      );
      if (at >= 0) s.candidates.splice(at, 0, candidate);
      else if (s.candidates.length < 32) s.candidates.push(candidate);
      if (s.candidates.length > 32) s.candidates.pop();
    }
    s.done = s.cursor === s.width * s.height;
    return { work, rays };
  }
}
