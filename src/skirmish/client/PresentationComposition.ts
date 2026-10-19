import type { Snapshot } from "../Protocol";
import {
  COMBAT_PRESENTATION_DELAY_TICKS,
  CombatPresentationTimeline,
  type CombatPresentationFrame,
} from "./CombatPresentationTimeline";

type PresentedSquad = Snapshot["squads"][number];

/** Fields drawn from the undelayed movement playhead. Everything else on a
 * squad (headcount, manpower, weapon and strike state, combat targets,
 * identity) stays on the delayed combat playhead, with the snapshot's
 * volleys, projectiles and other facts. */
export const MOVEMENT_FIELDS = [
  "x",
  "y",
  "formation",
  "locomotion",
  "order",
  "queuedOrders",
  "moved",
  "embarkedOn",
  "charge",
  "movementStatus",
  "planningPaused",
  "occupancy",
  "structureTarget",
  "stance",
  "aiWithdrawal",
] as const satisfies readonly (keyof PresentedSquad)[];

export interface PresentationFrame extends CombatPresentationFrame {
  /** Undelayed playhead of the movement fields and formation poses. */
  movementTick: number;
  movementSource: Snapshot;
}

/** A transport stays where it is drawn; its hull is a combat fact. */
function composeAfloat(
  combat: PresentedSquad["afloat"],
  movement: PresentedSquad["afloat"],
): PresentedSquad["afloat"] {
  if (!movement || !combat || combat === movement) return movement;
  if (
    combat.hull === movement.hull &&
    combat.maxHull === movement.maxHull &&
    combat.passengerHealth === movement.passengerHealth &&
    combat.passengerHullDamage === movement.passengerHullDamage
  )
    return movement;
  return {
    ...movement,
    hull: combat.hull,
    maxHull: combat.maxHull,
    passengerHealth: combat.passengerHealth,
    passengerHullDamage: combat.passengerHullDamage,
  };
}

/** Movement fields from `movement`, all others from `combat`. Returns `combat`
 * itself when nothing differs, so pose memos keyed by identity still hit. */
export function composePresentedSquad(
  combat: PresentedSquad,
  movement: Pick<PresentedSquad, (typeof MOVEMENT_FIELDS)[number] | "afloat">,
): PresentedSquad {
  if (combat === movement) return combat;
  const afloat = composeAfloat(combat.afloat, movement.afloat);
  let changed = afloat !== combat.afloat;
  for (const field of MOVEMENT_FIELDS)
    if (!Object.is(combat[field], movement[field])) {
      changed = true;
      break;
    }
  if (!changed) return combat;
  const squad: Record<string, unknown> = { ...combat, afloat };
  for (const field of MOVEMENT_FIELDS) squad[field] = movement[field];
  return squad as unknown as PresentedSquad;
}

/** Two playheads over the same publications: combat facts keep the
 * presentation delay that lets whole wind-ups play before their releases,
 * while movement, orders and picking follow the latest snapshot.
 *
 * A squad gone from the latest snapshot but still in the delayed one stays
 * where it was last drawn until its terminal facts play and the delayed
 * playhead retires it. A squad new in the latest snapshot is drawn at once. */
export class SplitPresentationTimeline {
  private readonly combat: CombatPresentationTimeline;
  private readonly movement = new CombatPresentationTimeline(0);
  /** Last drawn movement row of each squad, held after it leaves the latest snapshot. */
  private readonly held = new Map<number, PresentedSquad>();
  private cached?: {
    combat: CombatPresentationFrame;
    movement: CombatPresentationFrame;
    frame: PresentationFrame;
  };
  constructor(delayTicks = COMBAT_PRESENTATION_DELAY_TICKS) {
    this.combat = new CombatPresentationTimeline(delayTicks);
  }
  update(snapshot: Snapshot): void {
    this.combat.update(snapshot);
    this.movement.update(snapshot);
  }
  clear(): void {
    this.combat.clear();
    this.movement.clear();
    this.held.clear();
    this.cached = undefined;
  }
  finish(): void {
    this.combat.finish();
    this.movement.finish();
  }
  seekLatest(): void {
    this.combat.seekLatest();
    this.movement.seekLatest();
  }
  sample(now: number, speed: number, paused: boolean): PresentationFrame | undefined {
    const combat = this.combat.sample(now, speed, paused),
      movement = this.movement.sample(now, speed, paused);
    if (!combat || !movement) return undefined;
    if (this.cached?.combat === combat && this.cached.movement === movement)
      return this.cached.frame;
    const frame: PresentationFrame = {
      ...combat,
      snapshot: this.compose(combat.snapshot, movement.snapshot),
      movementTick: Math.max(combat.tick, movement.tick),
      movementSource: movement.source,
    };
    this.cached = { combat, movement, frame };
    return frame;
  }
  private compose(combat: Snapshot, movement: Snapshot): Snapshot {
    if (combat === movement) {
      this.held.clear();
      for (const squad of movement.squads) this.held.set(squad.id, squad);
      return combat;
    }
    const delayed = new Map(combat.squads.map((s) => [s.id, s]));
    const squads: PresentedSquad[] = [];
    const latest = new Set<number>();
    for (const squad of movement.squads) {
      latest.add(squad.id);
      const fact = delayed.get(squad.id);
      squads.push(fact ? composePresentedSquad(fact, squad) : squad);
    }
    for (const fact of combat.squads) {
      if (latest.has(fact.id)) continue;
      const last = this.held.get(fact.id);
      squads.push(last ? composePresentedSquad(fact, last) : fact);
    }
    for (const squad of movement.squads) this.held.set(squad.id, squad);
    for (const id of this.held.keys())
      if (!latest.has(id) && !delayed.has(id)) this.held.delete(id);
    return { ...combat, squads };
  }
}
