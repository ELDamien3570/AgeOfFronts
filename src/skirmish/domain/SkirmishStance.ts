import { secondsToTicks } from '../Protocol';
import { FIXED, type Command, type Squad } from "../Protocol";
import { BUDGETS, SKIRMISH } from "../content/TacticalRules";
import type { Expansion } from "./Expansion";
import { formationDoctrine } from "./FormationGeometry";
export function validateStance(
  stance: Squad["stance"],
  lastWithdrawTick?: number,
): void {
  if (
    (stance !== undefined && !["default", "skirmish"].includes(stance)) ||
    (lastWithdrawTick !== undefined &&
      (!Number.isSafeInteger(lastWithdrawTick) || lastWithdrawTick < 0))
  )
    throw new Error("Invalid skirmish stance");
}
interface StanceState {
  id: number;
  sinceTick: number;
  anchor: { x: number; y: number };
  suppressed: boolean;
  phase: "ready" | "withdrawing";
  destination?: { x: number; y: number };
  until?: number;
  withdrawals: number[];
  threatId?: number;
  threatX?: number;
  threatY?: number;
  stationarySince?: number;
  stationaryWithdrawal?: boolean;
  armyId?: number;
}
/** Reload movement is one bounded advisory controller, independent of firing. */
export class SkirmishStance {
  private states = new Map<number, StanceState>();
  private cursor = 0;
  constructor(private readonly e: Expansion) {}
  checkpoint() {
    return structuredClone({ states: [...this.states], cursor: this.cursor });
  }
  restore(saved: ReturnType<SkirmishStance["checkpoint"]>): void {
    this.states.clear();
    if (
      !Number.isSafeInteger(saved.cursor) ||
      saved.cursor < 0 ||
      !Array.isArray(saved.states)
    )
      throw new Error("Invalid stance checkpoint");
    // A row may outlive its squad: step() drops it when the cursor reaches it,
    // so a live checkpoint can carry one and must restore unchanged.
    for (const [id, s] of structuredClone(saved.states)) {
      if (
        id !== s.id ||
        !Number.isSafeInteger(id) ||
        id < 0 ||
        !Number.isSafeInteger(s.sinceTick) ||
        s.sinceTick < 0 ||
        !["ready", "withdrawing"].includes(s.phase) ||
        typeof s.suppressed !== "boolean" ||
        ![s.anchor.x, s.anchor.y].every(Number.isSafeInteger) ||
        !Array.isArray(s.withdrawals) ||
        s.withdrawals.some((t) => !Number.isSafeInteger(t) || t < 0) ||
        s.withdrawals.length > SKIRMISH.maxPerMinute ||
        (s.destination &&
          ![s.destination.x, s.destination.y].every(Number.isSafeInteger)) ||
        (s.until !== undefined &&
          (!Number.isSafeInteger(s.until) || s.until < 0))
      )
        throw new Error("Invalid stance checkpoint");
      this.states.set(id, s);
    }
    this.cursor = saved.cursor;
  }
  eligible(s: Squad): boolean {
    const d = this.e.unit(s),
      f = formationDoctrine(s.definitionId),
      p = d.rangedAttack ?? d.attack;
    return (
      s.manpower?.model === "soldiers" &&
      !f.mounted &&
      !f.hull &&
      d.attack.channel === "ranged" &&
      p.channel === "ranged" &&
      (p.shotsPerReload ?? 0) >= 1 &&
      (p.reloadMs ?? 0) > 0
    );
  }
  command(c: Extract<Command, { type: "stance" }>): string | null {
    const w = this.e.world;
    if (w.players.find((p) => p.id === c.playerId)?.kind === "tribe")
      return "Tribes cannot use skirmish stance";
    const squads = [...new Set(c.squadIds)]
      .map((id) => w.squad(id))
      .filter(
        (s): s is Squad => !!s && s.playerId === c.playerId && this.eligible(s),
      );
    if (!squads.length)
      return "Select foot soldiers with reloadable ranged weapons";
    for (const s of squads) {
      w.updateSquad(s.id, { stance: c.stance });
      this.finish(s.id, false);
      if (c.stance === "skirmish") this.states.set(s.id, this.initial(s));
      else this.states.delete(s.id);
    }
    return null;
  }
  private initial(s: Squad): StanceState {
    const army = this.e.armies.armyOf(s.id);
    return {
      id: s.id,
      sinceTick: this.e.world.tick,
      anchor: this.e.armies.slotAnchor(s.id) ?? { x: s.x, y: s.y },
      suppressed: false,
      phase: "ready",
      withdrawals: [],
      armyId: army?.id,
    };
  }
  observe(c: Command): void {
    if (
      "squadIds" in c &&
      (c.type === "order" ||
        c.type === "charge" ||
        c.type === "attack-structure" ||
        c.type === "occupy")
    )
      for (const id of c.squadIds) {
        const state = this.states.get(id);
        // Only the commanding faction's own squads: a command naming another
        // faction's squad must not suppress that faction's stance (R2-M9).
        const owner = this.e.world.squad(id)?.playerId;
        if (state && (owner === undefined || owner === c.playerId)) {
          state.suppressed = true;
          this.finish(id, false);
        }
      }
    if (c.type === "army-order")
      for (const id of this.e.armies.armies.find((a) => a.id === c.armyId && a.playerId === c.playerId)
        ?.memberIds ?? []) {
        const state = this.states.get(id);
        if (state) {
          state.suppressed = c.order.type === "hold";
          this.finish(id, false);
          if (c.order.type !== "hold") {
            const s = this.e.world.squad(id);
            if (s) this.states.set(id, this.initial(s));
          }
        }
      }
  }
  active(id: number): boolean {
    return this.states.get(id)?.phase === "withdrawing";
  }
  private finish(id: number, returnToSlot: boolean): void {
    const state = this.states.get(id);
    if (!state || state.phase !== "withdrawing") return;
    const s = this.e.world.squad(id);
    state.phase = "ready";
    state.destination = undefined;
    state.until = undefined;
    if (!s) return;
    if (returnToSlot && this.e.armies.armyOf(id)) {
      const goal = this.e.armies.slotAnchor(id) ?? state.anchor,
        path = this.e.world.paths.find(
          this.e.world.tileOf(s),
          this.e.world.tileOf(goal),
          (t) => this.e.fortifications.blocked(t, s.playerId),
        );
      if (path !== null) this.e.world.setArmyMove(s, goal, path);
    } else if (returnToSlot) this.e.world.setArmyHold(s);
  }
  step(): void {
    const w = this.e.world;
    // Reconcile army posture with the same evaluator; no second retreat loop.
    for (const army of this.e.armies.armies)
      if (army.posture === "skirmish" && army.order.type !== "hold")
        for (const id of army.memberIds) {
          const s = w.squad(id);
          if (
            s &&
            this.eligible(s) &&
            !this.states.has(id) &&
            w.players.find((p) => p.id === s.playerId)?.kind !== "tribe"
          )
            this.states.set(id, this.initial(s));
        }
    const ids = [...this.states.keys()];
    if (!ids.length) return;
    for (let n = 0; n < Math.min(BUDGETS.skirmish, ids.length); n++) {
      const id = ids[this.cursor++ % ids.length],
        state = this.states.get(id)!,
        s = w.squad(id),
        army = this.e.armies.armyOf(id);
      if (!s || s.troops <= 0) {
        this.states.delete(id);
        continue;
      }
      if (s.stance !== "skirmish" && army?.posture !== "skirmish") {
        this.finish(id, true);
        this.states.delete(id);
        continue;
      }
      const cycle = s.weaponState?.ranged,
        remaining = (cycle?.nextTick ?? 0) - w.tick;
      if (
        state.suppressed ||
        (army && this.e.armies.directArmyAction(army.id)) ||
        army?.order.type === "hold" ||
        this.e.trenches.occupants.has(id) ||
        s.afloat ||
        s.embarkedOn !== null ||
        s.refit ||
        s.manpower?.enlargement ||
        s.charge ||
        s.structureTarget
      ) {
        this.finish(id, false);
        continue;
      }
      const nearby: Squad[] = [];
      w.spatialFacts("combat").groundAlive.query(
        s.x,
        s.y,
        SKIRMISH.cavalryDangerTiles * FIXED,
        nearby,
        s.playerId,
      );
      const threats = nearby.filter(
        (t) =>
          w.hostile(s.playerId, t.playerId) &&
          t.troops > 0 &&
          t.embarkedOn === null &&
          !t.afloat &&
          this.e
            .unit(t)
            .attack.targets.some((tag) => this.e.unit(s).tags.includes(tag)) &&
          Math.hypot(t.x - s.x, t.y - s.y) <=
            (formationDoctrine(t.definitionId).mounted
              ? SKIRMISH.cavalryDangerTiles
              : SKIRMISH.dangerTiles) *
              FIXED,
      );
      threats.sort(
        (a, b) =>
          Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y) ||
          a.id - b.id,
      );
      const threat = threats[0];
      if (state.phase === "withdrawing") {
        if (remaining <= 0 || !threat) this.finish(id, true);
        continue;
      }
      if (
        cycle?.reloadStartedTick === undefined ||
        remaining < SKIRMISH.minRemainingTicks ||
        !threat ||
        s.moved ||
        s.order.type === "move" ||
        w.tick - (s.lastWithdrawTick ?? -SKIRMISH.cooldownTicks) <
          SKIRMISH.cooldownTicks
      )
        continue;
      state.withdrawals = state.withdrawals.filter((t) => w.tick - t < secondsToTicks(60));
      if (state.withdrawals.length >= SKIRMISH.maxPerMinute) continue;
      if (
        state.threatId !== threat.id ||
        Math.hypot(
          threat.x - (state.threatX ?? threat.x),
          threat.y - (state.threatY ?? threat.y),
        ) >
          FIXED / 8
      ) {
        state.stationarySince = w.tick;
        state.stationaryWithdrawal = false;
      }
      state.threatId = threat.id;
      state.threatX = threat.x;
      state.threatY = threat.y;
      if (
        state.stationaryWithdrawal &&
        w.tick - (state.stationarySince ?? w.tick) >= secondsToTicks(3)
      )
        continue;
      const anchor = army
        ? (this.e.armies.slotAnchor(id) ?? state.anchor)
        : state.anchor;
      const angle = Math.atan2(s.y - threat.y, s.x - threat.x);
      for (const offset of [
        0,
        Math.PI / 6,
        -Math.PI / 6,
        Math.PI / 3,
        -Math.PI / 3,
      ]) {
        const point = {
          x: Math.round(
            s.x + Math.cos(angle + offset) * SKIRMISH.stepTiles * FIXED,
          ),
          y: Math.round(
            s.y + Math.sin(angle + offset) * SKIRMISH.stepTiles * FIXED,
          ),
        };
        if (
          Math.hypot(point.x - anchor.x, point.y - anchor.y) >
            SKIRMISH.leashTiles * FIXED ||
          !w.map.isValidCoord(
            Math.floor(point.x / FIXED),
            Math.floor(point.y / FIXED),
          ) ||
          !w.formationFits(s, point)
        )
          continue;
        const tile = w.tileOf(point);
        if (w.domainRoutes && !w.domainRoutes.clear(s, point)) continue;
        if (!this.e.fortifications.clearMovement(s, point, s.playerId, 0))
          continue;
        const path = w.domainRoutes
          ? [tile]
          : w.paths.find(w.tileOf(s), tile, (t) =>
              this.e.fortifications.blocked(t, s.playerId),
            );
        if (path === null) continue;
        state.phase = "withdrawing";
        state.destination = point;
        state.until = cycle.nextTick;
        state.withdrawals.push(w.tick);
        state.stationaryWithdrawal = true;
        w.updateSquad(id, { lastWithdrawTick: w.tick });
        w.setArmyMove(w.squad(id)!, point, path);
        break;
      }
    }
  }
}
