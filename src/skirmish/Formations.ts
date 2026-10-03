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
class Occupancy {
  readonly grid: SpatialGrid<ReservedPoint>;
  private readonly points = new Map<number, ReservedPoint[]>();
  constructor(private readonly map: GameMap) {
    this.grid = new SpatialGrid(
      map.width() * FIXED,
      map.height() * FIXED,
      4 * FIXED,
    );
  }
  // A full-map grid is costly to allocate on large maps (62,500 buckets at
  // 1000 x 1000), so instances are reused. Refilling empties the occupied
  // buckets and re-inserts in the same order, so queries match a fresh grid.
  reset(others: readonly Squad[]): this {
    this.grid.rebuild([]);
    this.points.clear();
    for (const squad of others) this.refresh(squad);
    return this;
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
  private batchGrid?: Occupancy;
  private scratch?: Occupancy;
  private scratchBusy = false;
  constructor(
    private readonly map: GameMap,
    private readonly paths: LandPaths,
    private readonly hostile?: FactionHostility,
  ) {}

  beginBatch(others: readonly Squad[]): void {
    this.batch = (this.batchGrid ??= new Occupancy(this.map)).reset(others);
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
    preferred?: Map<number, WorldPoint>,
    blocked?: (tile: number) => boolean,
  ): Map<number, WorldPoint> | null {
    if (this.batch)
      return this.planWith(
        this.batch.grid,
        center,
        members,
        maximumRadius,
        preferred,
        blocked,
      );
    // Reuse one scratch grid; a re-entrant call (none today) gets its own.
    if (this.scratchBusy)
      return this.planWith(
        new Occupancy(this.map).reset(others).grid,
        center,
        members,
        maximumRadius,
        preferred,
        blocked,
      );
    this.scratchBusy = true;
    try {
      const grid = (this.scratch ??= new Occupancy(this.map)).reset(
        others,
      ).grid;
      return this.planWith(
        grid,
        center,
        members,
        maximumRadius,
        preferred,
        blocked,
      );
    } finally {
      this.scratchBusy = false;
    }
  }

  private planWith(
    occupied: SpatialGrid<ReservedPoint>,
    center: number,
    members: FormationMember[],
    maximumRadius: number,
    preferred: Map<number, WorldPoint> | undefined,
    blocked: ((tile: number) => boolean) | undefined,
  ): Map<number, WorldPoint> | null {
    const target = tilePoint(this.map, center);
    const selected = new Set(members.map(({ squad }) => squad.id));
    // A formation owns only a handful of buckets, never another full-map grid.
    const slots = new Map<number, ReservedPoint[]>();
    const slotColumns = Math.ceil(this.map.width() / 4);
    const slotKey = (point: WorldPoint) => Math.floor(point.x / (4 * FIXED)) + Math.floor(point.y / (4 * FIXED)) * slotColumns;
    const neighbors: ReservedPoint[] = [];
    const nearbySlots: ReservedPoint[] = [];
    const free = (point: WorldPoint, squad: SquadGeometry) => {
      if (distanceSquared(point, target) > maximumRadius ** 2) return false;
      if (!standable(this.map, point, squadRadius(squad.kind))) return false;
      if (blocked?.(pointTile(this.map, point))) return false;
      if (!this.paths.connected(center, pointTile(this.map, point)))
        return false;
      occupied.query(point.x, point.y, 2 * FIXED, neighbors);
      nearbySlots.length = 0;
      const cx = Math.floor(point.x / (4 * FIXED)), cy = Math.floor(point.y / (4 * FIXED));
      for (let y = Math.max(0, cy - 1); y <= cy + 1; y++)
        for (let x = Math.max(0, cx - 1); x <= Math.min(slotColumns - 1, cx + 1); x++)
          for (const slot of slots.get(x + y * slotColumns) ?? []) nearbySlots.push(slot);
      return (
        neighbors.every(
          (other) =>
            selected.has(other.squadId) ||
            distanceSquared(point, other) >= squadSeparation(squad, other, this.hostile) ** 2,
        ) &&
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
