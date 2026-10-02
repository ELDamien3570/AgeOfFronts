import type { GameMap } from "../core/game/GameMap";
import { formationRingPoint, type FormationMember } from "./Formations";
import type { LandPaths } from "./Pathfinding";
import { FIXED, type Order, type Squad } from "./Protocol";
import type { WorldPoint } from "./SpatialGrid";
import {
  FORMATION_SPACING,
  distanceSquared,
  pointTile,
  squadRadius,
  squadSeparation,
  standable,
  tilePoint,
} from "./SquadGeometry";

type Member = Pick<Squad, "id" | "kind" | "playerId"> & { origin: WorldPoint };
type Reservation = Pick<Squad, "id" | "kind" | "playerId"> & WorldPoint;
export interface FormationPlanningState {
  center: number;
  maximumRadius: number;
  pending: Member[];
  selected: Set<number>;
  preferred?: Map<number, WorldPoint>;
  additionalOrders?: Map<number, Order[]>;
  occupied: Map<string, Reservation[]>;
  slots: Map<string, Reservation[]>;
  result: Map<number, WorldPoint>;
  phase:
    | "occupancy"
    | "slot"
    | "nearest"
    | "candidate"
    | "clearance"
    | "done"
    | "failed";
  other: number;
  order: number;
  index: number;
  columns: number;
  rows: number;
  forwardX: number;
  forwardY: number;
  ideal?: WorldPoint;
  member?: Member;
  nearest: number;
  nearestCursor: number;
  ring: number;
  perimeter: number;
  best?: WorldPoint;
  bestDistance: number;
  candidate?: WorldPoint;
  bucket: number;
  entry: number;
  checkingSlots: boolean;
}

/** Same slot geometry and tie order as Formations, with explicit continuations
 * inside occupancy population, member selection, perimeter and clearance work.
 * The owner must revalidate live occupancy before admitting the whole order.
 */
export class FormationPlanning {
  readonly state: FormationPlanningState;
  constructor(
    private readonly map: GameMap,
    private readonly paths: LandPaths,
    center: number,
    members: readonly FormationMember[],
    private readonly others: () => readonly Squad[],
    maximumRadius = Infinity,
    preferred?: Map<number, WorldPoint>,
    saved?: FormationPlanningState,
    additionalOrders?: Map<number, Order[]>,
  ) {
    if (saved) {
      this.state = saved;
      return;
    }
    const target = tilePoint(map, center),
      x =
        members.reduce((n, m) => n + m.origin.x, 0) /
        Math.max(1, members.length),
      y =
        members.reduce((n, m) => n + m.origin.y, 0) /
        Math.max(1, members.length),
      length = Math.hypot(target.x - x, target.y - y),
      columns = Math.ceil(Math.sqrt(members.length));
    this.state = {
      center,
      maximumRadius,
      preferred,
      additionalOrders,
      pending: members
        .map(({ squad, origin }) => ({
          id: squad.id,
          kind: squad.kind,
          playerId: squad.playerId,
          origin: { ...origin },
        }))
        .sort((a, b) => a.id - b.id),
      selected: new Set(members.map((m) => m.squad.id)),
      occupied: new Map(),
      slots: new Map(),
      result: new Map(),
      phase: members.length ? "occupancy" : "done",
      other: 0,
      order: -1,
      index: 0,
      columns,
      rows: Math.ceil(members.length / columns),
      forwardX: length ? (target.x - x) / length : 0,
      forwardY: length ? (target.y - y) / length : 1,
      nearest: 0,
      nearestCursor: 1,
      ring: -1,
      perimeter: 0,
      bestDistance: Infinity,
      bucket: 0,
      entry: 0,
      checkingSlots: false,
    };
  }
  checkpoint(): FormationPlanningState {
    return structuredClone(this.state);
  }
  private key(point: WorldPoint): string {
    return `${Math.floor(point.x / (4 * FIXED))}:${Math.floor(point.y / (4 * FIXED))}`;
  }
  private insert(
    buckets: Map<string, Reservation[]>,
    point: Reservation,
  ): void {
    const key = this.key(point),
      bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }
  private accept(point: WorldPoint): void {
    const s = this.state,
      member = s.member!;
    s.result.set(member.id, point);
    this.insert(s.slots, { ...point, ...member });
    s.index++;
    s.phase = s.pending.length ? "slot" : "done";
  }
  private tested(free: boolean): void {
    const s = this.state;
    if (s.ring < 0) {
      if (free) {
        this.accept(s.candidate!);
        return;
      }
      s.ring = 0;
      s.perimeter = 0;
      s.best = undefined;
      s.bestDistance = Infinity;
    } else if (free) {
      s.best = s.candidate;
      s.bestDistance = distanceSquared(s.candidate!, s.ideal!);
    }
    s.phase = "candidate";
  }
  step(budget: number, blocked?: (tile: number) => boolean): number {
    if (!Number.isInteger(budget) || budget < 0)
      throw new Error("Invalid formation work budget");
    const s = this.state,
      target = tilePoint(this.map, s.center);
    let used = 0;
    while (used < budget && s.phase !== "done" && s.phase !== "failed") {
      used++;
      if (s.phase === "occupancy") {
        const squad = this.others()[s.other];
        if (!squad) {
          s.phase = "slot";
          continue;
        }
        if (squad.embarkedOn !== null || s.selected.has(squad.id)) {
          s.other++;
          s.order = -1;
          continue;
        }
        if (s.order === -1)
          this.insert(s.occupied, {
            id: squad.id,
            kind: squad.kind,
            playerId: squad.playerId,
            x: squad.x,
            y: squad.y,
          });
        else {
          const index = s.order - 1,
            extra = s.additionalOrders?.get(squad.id);
          const order =
            s.order === 0
              ? squad.order
              : index < squad.queuedOrders.length
                ? squad.queuedOrders[index]
                : extra?.[index - squad.queuedOrders.length];
          if (order?.type === "move")
            this.insert(s.occupied, {
              id: squad.id,
              kind: squad.kind,
              playerId: squad.playerId,
              ...(order.x === undefined
                ? tilePoint(this.map, order.tile)
                : { x: order.x, y: order.y! }),
            });
        }
        if (
          ++s.order >
          squad.queuedOrders.length +
            (s.additionalOrders?.get(squad.id)?.length ?? 0)
        ) {
          s.other++;
          s.order = -1;
        }
      } else if (s.phase === "slot") {
        const row = Math.floor(s.index / s.columns),
          rowWidth = Math.min(s.columns, s.selected.size - row * s.columns),
          lateral =
            ((s.index % s.columns) - (rowWidth - 1) / 2) * FORMATION_SPACING,
          depth = (row - (s.rows - 1) / 2) * FORMATION_SPACING;
        s.ideal = s.preferred?.get(s.pending[0].id) ?? {
          x: Math.round(target.x + s.forwardY * lateral + s.forwardX * depth),
          y: Math.round(target.y - s.forwardX * lateral + s.forwardY * depth),
        };
        s.nearest = 0;
        s.nearestCursor = 1;
        s.phase = "nearest";
      } else if (s.phase === "nearest") {
        if (!s.preferred && s.nearestCursor < s.pending.length) {
          const at = s.nearestCursor++;
          if (
            distanceSquared(s.pending[at].origin, s.ideal!) <
            distanceSquared(s.pending[s.nearest].origin, s.ideal!)
          )
            s.nearest = at;
        } else {
          s.member = s.pending.splice(s.nearest, 1)[0];
          s.ring = -1;
          s.candidate = s.ideal;
          s.phase = "candidate";
        }
      } else if (s.phase === "candidate") {
        if (s.ring >= 0) {
          if (s.perimeter >= (s.ring ? 8 * s.ring : 1)) {
            if (s.best) {
              this.accept(s.best);
              continue;
            }
            s.ring++;
            s.perimeter = 0;
            if (s.ring > 12 + s.columns) {
              s.phase = "failed";
              continue;
            }
          }
          const tile = formationRingPoint(
            Math.floor(s.ideal!.x / FIXED),
            Math.floor(s.ideal!.y / FIXED),
            s.ring,
            s.perimeter++,
          );
          s.candidate = {
            x: tile.x * FIXED + FIXED / 2,
            y: tile.y * FIXED + FIXED / 2,
          };
          if (distanceSquared(s.candidate, s.ideal!) >= s.bestDistance)
            continue;
        }
        const point = s.candidate!,
          tile = pointTile(this.map, point);
        if (
          distanceSquared(point, target) > s.maximumRadius ** 2 ||
          !standable(this.map, point, squadRadius(s.member!.kind)) ||
          blocked?.(tile) ||
          !this.paths.connected(s.center, tile)
        ) {
          this.tested(false);
          continue;
        }
        s.bucket = 0;
        s.entry = 0;
        s.checkingSlots = false;
        s.phase = "clearance";
      } else {
        const point = s.candidate!,
          x = Math.floor(point.x / (4 * FIXED)),
          y = Math.floor(point.y / (4 * FIXED)),
          key = `${x - 1 + (s.bucket % 3)}:${y - 1 + Math.floor(s.bucket / 3)}`,
          bucket = (s.checkingSlots ? s.slots : s.occupied).get(key),
          other = bucket?.[s.entry++];
        if (
          other &&
          (s.checkingSlots || !s.selected.has(other.id)) &&
          distanceSquared(point, other) < squadSeparation(s.member!, other) ** 2
        ) {
          this.tested(false);
          continue;
        }
        if (!other) {
          s.entry = 0;
          s.bucket++;
        }
        if (s.bucket === 9) {
          if (s.checkingSlots) this.tested(true);
          else {
            s.checkingSlots = true;
            s.bucket = 0;
          }
        }
      }
    }
    return used;
  }
}
