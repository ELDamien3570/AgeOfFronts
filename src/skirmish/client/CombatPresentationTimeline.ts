import { TICK_MS, type Snapshot } from "../Protocol";
import { TURN } from "../domain/FormationGeometry";
export const COMBAT_PRESENTATION_DELAY_TICKS = Math.ceil(500 / TICK_MS);

export interface CombatPresentationFrame {
  /** Discrete state changes only when the movement reaches this endpoint. */
  source: Snapshot;
  snapshot: Snapshot;
  tick: number;
}

/** One bounded presentation playhead for positions, headcounts and combat facts.
 * No extrapolation and no gameplay mutation. Interpolate canonical endpoints;
 * do not restart from a lagging drawn position whenever a publication arrives.
 */
export class CombatPresentationTimeline {
  constructor(private readonly delayTicks = 0) {}
  private draining = false;
  finish(): void { this.draining = true; this.cached = undefined; }
  /** Review-only explicit stepping; ordinary pause keeps the current playhead. */
  seekLatest(): void { if (this.frames.length) this.tick = this.frames[this.frames.length-1].tick; this.cached = undefined; }
  private readonly frames: Snapshot[] = [];
  private tick = 0;
  private previousTime?: number;
  private cached?: {
    now: number;
    speed: number;
    paused: boolean;
    frame: CombatPresentationFrame;
  };
  clear(): void {
    this.frames.length = 0;
    this.tick = 0;
    this.previousTime = undefined;
    this.cached = undefined;
    this.draining = false;
  }
  update(snapshot: Snapshot): void {
    const last = this.frames[this.frames.length - 1];
    if (last && snapshot.tick < last.tick) this.clear();
    if (!this.frames.length) this.tick = snapshot.tick;
    if (this.frames[this.frames.length - 1]?.tick === snapshot.tick)
      this.frames[this.frames.length - 1] = snapshot;
    else this.frames.push(snapshot);
    // An extended stall cannot retain an unbounded snapshot history.
    while (this.frames.length > this.delayTicks + 4) this.frames.shift();
    // Match the existing renderer's 600 ms catch-up bound for sparse updates.
    this.tick = Math.max(
      this.tick,
      this.frames[0].tick,
      snapshot.tick - this.delayTicks - 600 / TICK_MS,
    );
    this.cached = undefined;
  }
  sample(
    now: number,
    speed: number,
    paused: boolean,
  ): CombatPresentationFrame | undefined {
    if (!this.frames.length) return undefined;
    if (
      this.cached?.now === now &&
      this.cached.speed === speed &&
      this.cached.paused === paused
    )
      return this.cached.frame;
    const latest = this.frames[this.frames.length - 1];
    const elapsed =
      this.previousTime === undefined
        ? 0
        : Math.max(0, now - this.previousTime);
    this.previousTime = now;
    const ceiling = Math.max(this.tick, this.frames[0].tick,
      latest.tick - (this.draining || latest.winner !== null ? 0 : this.delayTicks));
    this.tick = paused
      ? this.delayTicks ? this.tick : latest.tick
      : Math.min(
          ceiling,
          this.tick + (elapsed * Math.max(0, speed)) / TICK_MS,
        );
    while (this.frames.length > 1 && this.frames[1].tick <= this.tick)
      this.frames.shift();
    const source = this.frames[0],
      next = this.frames[1];
    let snapshot = source;
    if (next && this.tick >= source.tick) {
      const fraction = (this.tick - source.tick) / (next.tick - source.tick),
        targets = new Map(next.squads.map((s) => [s.id, s]));
      const terminalRoots = new Map<number, { x: number; y: number }>();
      for (const hit of source.squads.some((s) => !targets.has(s.id))
        ? next.volleys
        : []) {
        if (!hit.combatRoots || hit.tick <= source.tick || hit.tick > next.tick)
          continue;
        terminalRoots.set(hit.squadId, {
          x: hit.combatRoots.sourceX,
          y: hit.combatRoots.sourceY,
        });
        if (hit.targetId !== undefined)
          terminalRoots.set(hit.targetId, {
            x: hit.combatRoots.targetX,
            y: hit.combatRoots.targetY,
          });
      }
      const visibleShots = new Map<number, {tick:number}>();
      const facts = [...source.volleys];
      const seen = new Set(facts.map(f => f.id));
      for (const fact of next.volleys) {
        if (fact.tick > this.tick) continue;
        if (!seen.has(fact.id)) { facts.push(fact); seen.add(fact.id); }
        if (!fact.melee && !fact.impact && fact.sourceKind !== "aircraft" &&
          fact.tick > (visibleShots.get(fact.squadId)?.tick ?? -Infinity)) visibleShots.set(fact.squadId, fact);
      }
      for (const projectile of next.expansion?.projectiles ?? [])
        if (projectile.sourceKind === "squad" && projectile.tick <= this.tick && projectile.tick > (visibleShots.get(projectile.sourceId)?.tick ?? -Infinity))
          visibleShots.set(projectile.sourceId, {tick:projectile.tick});
      const projectileIds = new Set(source.expansion?.projectiles.map(p => p.id));
      snapshot = {
        ...source,
        volleys: facts,
        expansion: source.expansion && next.expansion ? {...source.expansion,
          projectiles: [...source.expansion.projectiles, ...next.expansion.projectiles.filter(p =>
            p.tick <= this.tick && !projectileIds.has(p.id))]
            .map(p => p.impacted && this.tick < (p.impactAt ?? p.impactTick) ? {...p, impacted:false} : p),
        } : source.expansion,
        squads: source.squads.map((s) => {
          const target =
            targets.get(s.id) ??
            (terminalRoots.has(s.id)
              ? { ...s, ...terminalRoots.get(s.id)! }
              : undefined);
          if (!target) return s;
          let weaponState = s.weaponState;
          let action = weaponState?.rangedAction;
          const forthcoming = targets.get(s.id)?.weaponState?.rangedAction;
          // Announced preparation is visible at its own start tick, even if it
          // arrived in the next coalesced endpoint. Never pull HP/casualties early.
          if (forthcoming && forthcoming.startTick <= this.tick && forthcoming.sequence > (action?.sequence ?? 0)) {
            action = forthcoming;
            weaponState = {...(weaponState ?? {sharedReadyTick:0}), rangedSequence:action.sequence, rangedAction:action};
          }
          const shot = visibleShots.get(s.id);
          let lastAttackTick = s.lastAttackTick;
          if (shot && shot.tick > (s.weaponState?.ranged?.lastShotTick ?? s.lastAttackTick ?? -Infinity)) {
            lastAttackTick = shot.tick;
            if (weaponState?.ranged) weaponState = {...weaponState,ranged:{...weaponState.ranged,lastShotTick:shot.tick}};
            if (action && action.releaseTick <= shot.tick) {
              action = {...action,phase:action.phase === "sustaining" ? "sustaining" : "released"};
              weaponState = {...weaponState!,rangedAction:action};
            }
          }
          let formation = s.formation;
          if (
            formation &&
            target.formation &&
            !formation.transition &&
            !target.formation.transition
          ) {
            const turn =
              ((target.formation.facing - formation.facing + TURN * 1.5) %
                TURN) -
              TURN / 2;
            if (turn)
              formation = {
                ...formation,
                facing: formation.facing + turn * fraction,
              };
          }
          if (s.x === target.x && s.y === target.y && formation === s.formation && weaponState === s.weaponState && lastAttackTick === s.lastAttackTick)
            return s;
          return {
            ...s,
            weaponState, lastAttackTick,
            x: s.x + (target.x - s.x) * fraction,
            y: s.y + (target.y - s.y) * fraction,
            formation,
          };
        }),
      };
    }
    const frame = { source, snapshot, tick: this.tick };
    this.cached = { now, speed, paused, frame };
    return frame;
  }
}
