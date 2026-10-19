import { formationMovementProfile } from "../FormationMovementProfile";
import { headingDifference, pointHeading } from "../FormationLocomotion";
import { MOTION } from "../content/TacticalRules";
import { FIXED, TICKS_PER_SECOND, type Order, type Squad } from "../Protocol";

/** Presentation-only response to a local order before the authoritative
 * publication that carries it is drawn. It never predicts translation and
 * never feeds back into commands, selection or the simulation. */
export const PENDING_ORDER = Object.freeze({
  /** Marker and unconfirmed-turn lifetime from the click. Reconciliation reads
   * the undelayed movement playhead, so confirmation is network + tick +
   * publication + one interpolation interval: about 0.4-0.9 s online. */
  timeoutMs: 1200,
  /** Hand-over or release of a predicted facing. */
  blendMs: 150,
  /** Authoritative facing without change for this long is settled. */
  settleMs: 200,
  /** A confirmed order whose facing never changes releases after this. */
  confirmedHoldMs: 400,
  /** Absolute bound on any predicted facing. */
  maximumMs: 2500,
  closeAngle: Math.PI / 60,
  changeAngle: Math.PI / 180,
  /** Simulation.advanceFormationStates ignores deployed-body turns below
   * 65536/12 facing units; such a body keeps its layout and only soldiers turn. */
  reorientAngle: Math.PI / 6,
  /** Move confirmation tolerance around the clicked point, in tiles. */
  moveRadius: 3,
  moveRadiusPerSquad: 1.5,
  lineRadius: 2,
});

export type PendingOrderSquad = Pick<
  Squad,
  | "id"
  | "kind"
  | "x"
  | "y"
  | "order"
  | "queuedOrders"
  | "embarkedOn"
  | "afloat"
  | "refit"
  | "charge"
  | "fighting"
  | "locomotion"
  | "occupancy"
  | "cavalryEngagement"
>;
interface Point {
  x: number;
  y: number;
}
export type PendingOrderTarget =
  | { type: "move"; point: Point; slots?: ReadonlyMap<number, Point> }
  | { type: "attack"; targetId: number };

interface Turn {
  rate: number;
  angle?: number;
  target?: number;
  baseline?: number;
  /** Presented body angle when the prediction began. */
  body?: number;
  last?: number;
  changedAt: number;
  confirmedAt?: number;
  blendAt?: number;
  blendFrom?: number;
  reorients?: boolean;
}
interface Entry {
  token: number;
  squadId: number;
  issuedAt: number;
  updatedAt: number;
  append: boolean;
  point?: Point;
  radius: number;
  targetId?: number;
  marker: boolean;
  rejected: boolean;
  turn?: Turn;
}
export interface PendingOrderMarker {
  squadId: number;
  attack: boolean;
  /** Fixed world units; for an attack, the target's presented position. */
  point: Point;
}

const normalize = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
/** Bounded turn with wrap-around; it never passes the target. */
export function stepAngle(from: number, to: number, maximum: number): number {
  const error = headingDifference(from, to);
  return normalize(from + Math.max(-maximum, Math.min(maximum, error)));
}
/** The pivot rate the simulation applies before launch (FormationLocomotion). */
export const pendingTurnRate = (squad: Pick<Squad, "kind">) =>
  formationMovementProfile(squad.kind === "cavalry").reformTurnRate;
/** Mirrors the obvious simulation states in which a squad does not pivot to a
 * new order. When unsure, no facing is predicted. */
export function turnPredictable(squad: PendingOrderSquad): boolean {
  if (squad.embarkedOn !== null || squad.afloat || squad.refit || squad.charge) return false;
  if (squad.fighting || squad.cavalryEngagement || squad.occupancy) return false;
  const brake = (formationMovementProfile(squad.kind === "cavalry").squadBraking * FIXED) / TICKS_PER_SECOND ** 2;
  // A travelling squad turns through its velocity, not the in-place pivot.
  return (squad.locomotion?.speed ?? 0) <= brake;
}
const ease = (t: number) => t * t * (3 - 2 * t);
const moveDestination = (order: Readonly<Extract<Order, { type: "move" }>>, width: number) => ({
  x: order.x ?? ((order.tile % width) + 0.5) * FIXED,
  y: order.y ?? (Math.floor(order.tile / width) + 0.5) * FIXED,
});

/** Per-squad pending orders: a destination marker until the presented order
 * carries it, and a predicted facing handed over to the authoritative one. */
export class PendingOrderPresentation {
  private readonly entries = new Map<number, Entry>();
  private nextToken = 1;
  get active(): boolean {
    return this.entries.size > 0;
  }
  clear(): void {
    this.entries.clear();
  }
  /** Returns a token for rejection. A newer order replaces a squad's older one. */
  issue(
    now: number,
    squads: readonly PendingOrderSquad[],
    target: PendingOrderTarget,
    append = false,
  ): number {
    const token = this.nextToken++;
    const radius =
      target.type === "move" && target.slots
        ? PENDING_ORDER.lineRadius
        : PENDING_ORDER.moveRadius + PENDING_ORDER.moveRadiusPerSquad * Math.sqrt(squads.length);
    for (const squad of squads) {
      const point =
        target.type === "move" ? (target.slots?.get(squad.id) ?? target.point) : undefined;
      const old = this.entries.get(squad.id);
      // A replaced prediction continues from its drawn facing.
      const previous = old?.turn?.angle;
      const turn: Turn | undefined =
        !append && turnPredictable(squad)
          ? {
              rate: pendingTurnRate(squad),
              changedAt: now,
              ...(previous === undefined ? {} : { angle: previous }),
            }
          : undefined;
      this.entries.set(squad.id, {
        token,
        squadId: squad.id,
        issuedAt: now,
        updatedAt: now,
        append,
        point: point && { x: point.x, y: point.y },
        radius,
        targetId: target.type === "attack" ? target.targetId : undefined,
        marker: true,
        rejected: false,
        turn,
      });
    }
    return token;
  }
  reject(token: number, now: number): void {
    for (const entry of this.entries.values())
      if (entry.token === token) {
        entry.rejected = true;
        entry.marker = false;
        this.release(entry, now);
      }
  }
  /** Whether the presented squad's order already carries this pending order. */
  matches(entry: Pick<Entry, "point" | "radius" | "targetId" | "append">, squad: PendingOrderSquad, width: number): boolean {
    const orders = entry.append ? [squad.order, ...squad.queuedOrders] : [squad.order];
    return orders.some((order) => {
      if (entry.targetId !== undefined) return order.type === "attack" && order.targetId === entry.targetId;
      if (order.type !== "move" || !entry.point) return false;
      const point = moveDestination(order, width);
      return Math.hypot(point.x - entry.point.x, point.y - entry.point.y) <= entry.radius * FIXED;
    });
  }
  /** Once per drawn frame, against the presented (drawn) snapshot. `facing` is
   * the authoritative soldier facing and `body` the drawn formation angle;
   * `position` resolves attack targets. */
  reconcile(
    now: number,
    width: number,
    squad: (id: number) => PendingOrderSquad | undefined,
    facing: (squad: PendingOrderSquad) => number,
    body: (squad: PendingOrderSquad) => number = facing,
    position: (id: number) => Point | undefined = (id) => squad(id),
  ): void {
    for (const [id, entry] of this.entries) {
      const live = squad(id);
      if (!live) {
        this.entries.delete(id);
        continue;
      }
      const elapsed = now - entry.issuedAt,
        dt = Math.max(0, now - entry.updatedAt) / 1000;
      entry.updatedAt = now;
      const matched = !entry.rejected && this.matches(entry, live, width);
      if (entry.targetId !== undefined) {
        const target = position(entry.targetId);
        if (target) entry.point = { x: target.x, y: target.y };
        else entry.marker = false;
      }
      if (matched || elapsed >= PENDING_ORDER.timeoutMs) entry.marker = false;
      const turn = entry.turn;
      if (turn) {
        const authoritative = facing(live);
        turn.angle ??= authoritative;
        turn.baseline ??= authoritative;
        turn.body ??= body(live);
        if (turn.last === undefined || Math.abs(headingDifference(turn.last, authoritative)) > PENDING_ORDER.changeAngle)
          turn.changedAt = now;
        turn.last = authoritative;
        if (turn.blendAt === undefined) {
          if (entry.point && Math.hypot(entry.point.x - live.x, entry.point.y - live.y) > MOTION.arrivalDeadband)
            turn.target = pointHeading(live, entry.point);
          if (turn.target !== undefined) {
            turn.reorients ??= Math.abs(headingDifference(turn.angle, turn.target)) >= PENDING_ORDER.reorientAngle;
            turn.angle = stepAngle(turn.angle, turn.target, turn.rate * dt);
          }
          if (matched) turn.confirmedAt ??= now;
          if (this.handover(turn, live, now, elapsed, matched, authoritative)) this.release(entry, now);
        }
        if (turn.blendAt !== undefined && now - turn.blendAt >= PENDING_ORDER.blendMs) entry.turn = undefined;
      }
      if (!entry.marker && !entry.turn) this.entries.delete(id);
    }
  }
  private handover(
    turn: Turn,
    squad: PendingOrderSquad,
    now: number,
    elapsed: number,
    matched: boolean,
    authoritative: number,
  ): boolean {
    if (!turnPredictable(squad) || elapsed >= PENDING_ORDER.maximumMs) return true;
    if (!matched) return elapsed >= PENDING_ORDER.timeoutMs;
    if (Math.abs(headingDifference(authoritative, turn.angle!)) <= PENDING_ORDER.closeAngle) return true;
    const settled = now - turn.changedAt >= PENDING_ORDER.settleMs;
    const moved = Math.abs(headingDifference(turn.baseline!, authoritative)) > PENDING_ORDER.changeAngle;
    // While the drawn authoritative facing is still turning, keep the
    // prediction; blending toward a moving facing would swing it back.
    if (moved) return settled;
    return now - turn.confirmedAt! >= PENDING_ORDER.confirmedHoldMs;
  }
  private release(entry: Entry, now: number): void {
    const turn = entry.turn;
    if (!turn || turn.blendAt !== undefined) return;
    if (turn.angle === undefined) {
      entry.turn = undefined;
      return;
    }
    turn.blendAt = now;
    turn.blendFrom = turn.angle;
  }
  /** Drawn facing for this squad, or undefined when the authoritative facing
   * applies. During hand-over it blends toward the supplied authoritative
   * angle, so any presentation channel can share one prediction. */
  angle(id: number, now: number, authoritative: number): number | undefined {
    const turn = this.entries.get(id)?.turn;
    if (!turn || turn.angle === undefined) return undefined;
    if (turn.blendAt === undefined) return turn.angle;
    const progress = Math.min(1, Math.max(0, (now - turn.blendAt) / PENDING_ORDER.blendMs));
    if (progress >= 1) return undefined;
    return normalize(turn.blendFrom! + headingDifference(turn.blendFrom!, authoritative) * ease(progress));
  }
  /** Drawn formation body angle: the presented body turned by the predicted
   * rotation, then blended into the supplied authoritative body angle. */
  bodyAngle(id: number, now: number, authoritative: number): number | undefined {
    const turn = this.entries.get(id)?.turn;
    if (!turn || turn.angle === undefined || turn.body === undefined) return undefined;
    const turned = (angle: number) => normalize(turn.body! + headingDifference(turn.baseline!, angle));
    if (turn.blendAt === undefined) return turned(turn.angle);
    const progress = Math.min(1, Math.max(0, (now - turn.blendAt) / PENDING_ORDER.blendMs));
    if (progress >= 1) return undefined;
    const from = turned(turn.blendFrom!);
    return normalize(from + headingDifference(from, authoritative) * ease(progress));
  }
  /** Whether the simulation would rebuild a deployed body for this turn. */
  reorients(id: number): boolean {
    return !!this.entries.get(id)?.turn?.reorients;
  }
  *markers(): Iterable<PendingOrderMarker> {
    for (const entry of this.entries.values())
      if (entry.marker && entry.point)
        yield { squadId: entry.squadId, attack: entry.targetId !== undefined, point: entry.point };
  }
}
