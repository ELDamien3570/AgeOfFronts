import type { GameMap } from "../core/game/GameMap";
import type { LandPaths } from "./Pathfinding";
import { FIXED, type Squad } from "./Protocol";
import { SpatialGrid, type WorldPoint } from "./SpatialGrid";
import {
  FORMATION_SPACING,
  distanceSquared,
  pointTile,
  squadRadius,
  squadSeparation,
  standable,
  tilePoint,
  type SquadGeometry,
} from "./SquadGeometry";

interface ReservedPoint extends WorldPoint, SquadGeometry {
  squadId: number;
}
class Occupancy {
  readonly grid: SpatialGrid<ReservedPoint>;
  private readonly points = new Map<number, ReservedPoint[]>();
  constructor(
    private readonly map: GameMap,
    others: readonly Squad[],
  ) {
    this.grid = new SpatialGrid(
      map.width() * FIXED,
      map.height() * FIXED,
      4 * FIXED,
    );
    for (const squad of others) this.refresh(squad);
  }
  refresh(squad: Squad) {
    for (const point of this.points.get(squad.id) ?? [])
      this.grid.remove(point);
    const points: ReservedPoint[] = [];
    if (squad.embarkedOn === null) {
      points.push({
        x: squad.x,
        y: squad.y,
        kind: squad.kind,
        playerId: squad.playerId,
        squadId: squad.id,
      });
      for (const order of [squad.order, ...squad.queuedOrders]) {
        if (order.type !== "move") continue;
        const end =
          order.x === undefined
            ? tilePoint(this.map, order.tile)
            : { x: order.x, y: order.y! };
        points.push({
          ...end,
          kind: squad.kind,
          playerId: squad.playerId,
          squadId: squad.id,
        });
      }
    }
    this.points.set(squad.id, points);
    for (const point of points) this.grid.insert(point);
  }
}
export interface FormationMember {
  squad: Squad;
  origin: WorldPoint;
}

// A movement command owns its slots; client control groups only select units.
export class Formations {
  private batch?: Occupancy;
  constructor(
    private readonly map: GameMap,
    private readonly paths: LandPaths,
  ) {}

  beginBatch(others: readonly Squad[]): void {
    this.batch = new Occupancy(this.map, others);
  }
  endBatch(): void {
    this.batch = undefined;
  }
  refresh(squad: Squad): void {
    this.batch?.refresh(squad);
  }

  plan(
    center: number,
    members: FormationMember[],
    others: readonly Squad[],
    maximumRadius = Infinity,
  ): Map<number, WorldPoint> | null {
    const target = tilePoint(this.map, center);
    const selected = new Set(members.map(({ squad }) => squad.id));
    const occupied = (this.batch ?? new Occupancy(this.map, others)).grid;
    const slots: ReservedPoint[] = [];
    const neighbors: ReservedPoint[] = [];
    const free = (point: WorldPoint, squad: SquadGeometry) => {
      if (distanceSquared(point, target) > maximumRadius ** 2) return false;
      if (!standable(this.map, point, squadRadius(squad.kind))) return false;
      if (!this.paths.connected(center, pointTile(this.map, point)))
        return false;
      occupied.query(point.x, point.y, 2 * FIXED, neighbors);
      return (
        neighbors.every(
          (other) =>
            selected.has(other.squadId) ||
            distanceSquared(point, other) >= squadSeparation(squad, other) ** 2,
        ) &&
        slots.every(
          (other) =>
            distanceSquared(point, other) >= squadSeparation(squad, other) ** 2,
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
      const ideal = {
        x: Math.round(target.x + forwardY * lateral + forwardX * depth),
        y: Math.round(target.y - forwardX * lateral + forwardY * depth),
      };
      // Nearby members get nearby slots, independent of selection-array order.
      let memberIndex = 0;
      for (let i = 1; i < pending.length; i++)
        if (
          distanceSquared(pending[i].origin, ideal) <
          distanceSquared(pending[memberIndex].origin, ideal)
        )
          memberIndex = i;
      const member = pending.splice(memberIndex, 1)[0];
      let point: WorldPoint | undefined = free(ideal, member.squad)
        ? ideal
        : undefined;
      // Irregular coasts and existing armies get distinct nearby fallback slots.
      // Never silently collapse an invalid formation back onto a common center.
      const ix = Math.floor(ideal.x / FIXED),
        iy = Math.floor(ideal.y / FIXED);
      for (let ring = 0; !point && ring <= 12 + columns; ring++) {
        let best: WorldPoint | undefined,
          bestDistance = Infinity;
        for (let y = iy - ring; y <= iy + ring; y++)
          for (let x = ix - ring; x <= ix + ring; x++) {
            if (ring && Math.max(Math.abs(x - ix), Math.abs(y - iy)) !== ring)
              continue;
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
      slots.push({
        ...point,
        squadId: member.squad.id,
        kind: member.squad.kind,
        playerId: member.squad.playerId,
      });
    }
    return result;
  }
}
