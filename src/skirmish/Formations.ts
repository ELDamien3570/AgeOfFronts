import type { GameMap } from "../core/game/GameMap";
import type { LandPaths } from "./Pathfinding";
import { FIXED, type Squad } from "./Protocol";
import { type WorldPoint } from "./SpatialGrid";
import {
  FORMATION_SPACING,
  distanceSquared,
  pointTile,
  squadRadius,
  squadSeparation,
  standable,
  tilePoint,
  type FactionHostility,
  type SquadGeometry,
} from "./SquadGeometry";

interface ReservedPoint extends WorldPoint, SquadGeometry {
  squadId: number;
}
/** Square perimeter in the same row-major order as the former square scan. */
export function formationRingPoint(cx: number, cy: number, ring: number, index: number): WorldPoint {
  if (!ring) return { x: cx, y: cy };
  const width = 2 * ring + 1;
  if (index < width) return { x: cx - ring + index, y: cy - ring };
  index -= width;
  const sides = 2 * (2 * ring - 1);
  if (index < sides) return { x: cx + (index % 2 ? ring : -ring), y: cy - ring + 1 + Math.floor(index / 2) };
  return { x: cx - ring + index - sides, y: cy + ring };
}
export interface FormationMember {
  squad: Squad;
  origin: WorldPoint;
}

// A movement command owns its slots; client control groups only select units.
export class Formations {
  constructor(
    private readonly map: GameMap,
    private readonly paths: LandPaths,
    private readonly hostile?: FactionHostility,
    /** A faction's squad graph; amphibious factions may stand on water. */
    private readonly squadPaths?: (playerId: number) => LandPaths,
  ) {}

  plan(
    center: number,
    members: FormationMember[],
    others: readonly Squad[],
    maximumRadius = Infinity,
    preferred?: Map<number, WorldPoint>,
    blocked?: (tile: number) => boolean,
    exactPreferred = false,
  ): Map<number, WorldPoint> | null {
    return this.planWith(center,members,maximumRadius,preferred,blocked,exactPreferred);
  }

  private planWith(
    center: number,
    members: FormationMember[],
    maximumRadius: number,
    preferred: Map<number, WorldPoint> | undefined,
    blocked: ((tile: number) => boolean) | undefined,
    exactPreferred: boolean,
  ): Map<number, WorldPoint> | null {
    const target = tilePoint(this.map, center);
    const paths = members.length ? this.squadPaths?.(members[0].squad.playerId) ?? this.paths : this.paths;
    // A formation owns only a handful of buckets, never another full-map grid.
    const slots = new Map<number, ReservedPoint[]>();
    const slotColumns = Math.ceil(this.map.width() / 4);
    const slotKey = (point: WorldPoint) => Math.floor(point.x / (4 * FIXED)) + Math.floor(point.y / (4 * FIXED)) * slotColumns;
    const nearbySlots: ReservedPoint[] = [];
    const free = (point: WorldPoint, squad: SquadGeometry) => {
      if (distanceSquared(point, target) > maximumRadius ** 2) return false;
      if (!standable(this.map, point, squadRadius(squad.kind), paths.amphibious)) return false;
      if (blocked?.(pointTile(this.map, point))) return false;
      if (!paths.connected(center, pointTile(this.map, point)))
        return false;
      nearbySlots.length = 0;
      const cx = Math.floor(point.x / (4 * FIXED)), cy = Math.floor(point.y / (4 * FIXED));
      for (let y = Math.max(0, cy - 1); y <= cy + 1; y++)
        for (let x = Math.max(0, cx - 1); x <= Math.min(slotColumns - 1, cx + 1); x++)
          for (const slot of slots.get(x + y * slotColumns) ?? []) nearbySlots.push(slot);
      return (
        nearbySlots.every(
          (other) =>
            distanceSquared(point, other) >= squadSeparation(squad, other, this.hostile) ** 2,
        )
      );
    };
    const columns = Math.ceil(Math.sqrt(members.length));
    const rows = Math.ceil(members.length / columns);
    const originX =
      members.reduce((sum, member) => sum + member.origin.x, 0) /
      members.length;
    const originY =
      members.reduce((sum, member) => sum + member.origin.y, 0) /
      members.length;
    const length = Math.hypot(target.x - originX, target.y - originY);
    const forwardX = length ? (target.x - originX) / length : 0;
    const forwardY = length ? (target.y - originY) / length : 1;
    const pending = [...members].sort((a, b) => a.squad.id - b.squad.id);
    const result = new Map<number, WorldPoint>();
    for (let index = 0; index < members.length; index++) {
      const row = Math.floor(index / columns);
      const rowWidth = Math.min(columns, members.length - row * columns);
      const lateral =
        ((index % columns) - (rowWidth - 1) / 2) * FORMATION_SPACING;
      const depth = (row - (rows - 1) / 2) * FORMATION_SPACING;
      const ideal = preferred?.get(pending[0].squad.id) ?? {
        x: Math.round(target.x + forwardY * lateral + forwardX * depth),
        y: Math.round(target.y - forwardX * lateral + forwardY * depth),
      };
      // Nearby members get nearby slots, independent of selection-array order.
      let memberIndex = 0;
      for (let i = 1; !preferred && i < pending.length; i++)
        if (
          distanceSquared(pending[i].origin, ideal) <
          distanceSquared(pending[memberIndex].origin, ideal)
        )
          memberIndex = i;
      const member = pending.splice(memberIndex, 1)[0];
      let point: WorldPoint | undefined = free(ideal, member.squad)
        ? ideal
        : undefined;
      if (!point && exactPreferred) return null;
      // Irregular coasts and existing armies get distinct nearby fallback slots.
      // Never silently collapse an invalid formation back onto a common center.
      const ix = Math.floor(ideal.x / FIXED),
        iy = Math.floor(ideal.y / FIXED);
      for (let ring = 0; !point && ring <= 12 + columns; ring++) {
        let best: WorldPoint | undefined,
          bestDistance = Infinity;
        for (let at = 0; at < (ring ? 8 * ring : 1); at++) {
            const {x, y} = formationRingPoint(ix, iy, ring, at);
            const candidate = {
              x: x * FIXED + FIXED / 2,
              y: y * FIXED + FIXED / 2,
            };
            const distance = distanceSquared(candidate, ideal);
            if (distance < bestDistance && free(candidate, member.squad)) {
              best = candidate;
              bestDistance = distance;
            }
          }
        point = best;
      }
      if (!point) return null;
      result.set(member.squad.id, point);
      const key = slotKey(point);
      let bucket = slots.get(key);
      if (!bucket) slots.set(key, bucket = []);
      bucket.push({
        ...point,
        squadId: member.squad.id,
        kind: member.squad.kind,
        playerId: member.squad.playerId,
      });
    }
    return result;
  }
}
