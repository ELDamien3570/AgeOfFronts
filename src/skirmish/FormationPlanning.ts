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
  /** Undefined means no radius limit; persisted state contains no Infinity sentinel. */
  maximumRadius: number | undefined;
  pending: Member[];
  selected: Set<number>;
  preferred?: Map<number, WorldPoint>;
  additionalOrders?: Map<number, Order[]>;
  occupied: Map<string, Reservation[]>;
  slots: Map<string, Reservation[]>;
  result: Map<number, WorldPoint>;
  setup?: { members: Member[]; cursor: number; sumX: number; sumY: number; sort: number; insert: number };
  consumed?: Set<number>;
  first?: number;
  phase:
    | "setup"
    | "sort"
    | "first"
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
  /** Undefined until a legal candidate exists. */
  bestDistance: number | undefined;
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
  static normalizeCheckpoint(state: FormationPlanningState): void {
    // Earlier structured checkpoints used positive Infinity for these two
    // explicit unset states. Preserve their exact meaning on migration.
    if (state.maximumRadius === Infinity) state.maximumRadius = undefined;
    if (state.bestDistance === Infinity) state.bestDistance = undefined;
  }
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
      FormationPlanning.normalizeCheckpoint(this.state);
      return;
    }
    // Capture command scalars at the atomic input boundary (the selected cohort
    // is capped by MAX_SQUADS). Sorting, orientation and membership population
    // run inside the allowance and survive checkpoint/restore.
    const columns = Math.ceil(Math.sqrt(members.length));
    this.state = {
      center,
      maximumRadius: maximumRadius === Infinity ? undefined : maximumRadius,
      preferred,
      additionalOrders,
      pending: [],
      setup: { members: members.map(({squad, origin}) => ({id:squad.id, kind:squad.kind, playerId:squad.playerId, origin:{...origin}})), cursor:0, sumX:0, sumY:0, sort:1, insert:1 },
      consumed: new Set(),
      selected: new Set(),
      occupied: new Map(),
      slots: new Map(),
      result: new Map(),
      phase: members.length ? "setup" : "done",
      other: 0,
      order: -1,
      index: 0,
      columns,
      rows: Math.ceil(members.length / columns),
      forwardX: 0,
      forwardY: 1,
      nearest: 0,
      nearestCursor: 1,
      ring: -1,
      perimeter: 0,
      bestDistance: undefined,
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
    s.phase = s.result.size < s.selected.size ? "slot" : "done";
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
      s.bestDistance = undefined;
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
      if (s.phase === "setup") {
        const setup = s.setup!, member = setup.members[setup.cursor++];
        if (member) {
          s.pending.push(member); s.selected.add(member.id);
          setup.sumX += member.origin.x; setup.sumY += member.origin.y;
        } else {
          const x = setup.sumX / s.pending.length, y = setup.sumY / s.pending.length;
          const length = Math.hypot(target.x-x, target.y-y);
          s.forwardX = length ? (target.x-x)/length : 0;
          s.forwardY = length ? (target.y-y)/length : 1;
          s.phase = "sort";
        }
      } else if (s.phase === "sort") {
        const setup = s.setup!;
        if (setup.sort >= s.pending.length) { s.setup = undefined; s.phase = "occupancy"; }
        else if (setup.insert > 0 && s.pending[setup.insert-1].id > s.pending[setup.insert].id) {
          const at = setup.insert--;
          [s.pending[at-1], s.pending[at]] = [s.pending[at], s.pending[at-1]];
        } else { setup.sort++; setup.insert = setup.sort; }
      } else if (s.phase === "occupancy") {
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
        s.first = 0; s.phase = "first";
      } else if (s.phase === "first") {
        if (s.consumed?.has(s.pending[s.first!]?.id)) { s.first!++; continue; }
        const row = Math.floor(s.index / s.columns),
          rowWidth = Math.min(s.columns, s.selected.size - row * s.columns),
          lateral =
            ((s.index % s.columns) - (rowWidth - 1) / 2) * FORMATION_SPACING,
          depth = (row - (s.rows - 1) / 2) * FORMATION_SPACING;
        s.ideal = s.preferred?.get(s.pending[s.first!].id) ?? {
          x: Math.round(target.x + s.forwardY * lateral + s.forwardX * depth),
          y: Math.round(target.y - s.forwardX * lateral + s.forwardY * depth),
        };
        s.nearest = s.first!;
        s.nearestCursor = s.first! + 1;
        s.phase = "nearest";
      } else if (s.phase === "nearest") {
        if (!s.preferred && s.nearestCursor < s.pending.length) {
          const at = s.nearestCursor++;
          if (
            !s.consumed?.has(s.pending[at].id) &&
            distanceSquared(s.pending[at].origin, s.ideal!) <
            distanceSquared(s.pending[s.nearest].origin, s.ideal!)
          )
            s.nearest = at;
        } else {
          s.member = s.pending[s.nearest];
          (s.consumed ??= new Set()).add(s.member.id);
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
          if (distanceSquared(s.candidate, s.ideal!) >= (s.bestDistance ?? Infinity))
            continue;
        }
        const point = s.candidate!,
          tile = pointTile(this.map, point);
        if (
          (s.maximumRadius !== undefined && distanceSquared(point, target) > s.maximumRadius ** 2) ||
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
