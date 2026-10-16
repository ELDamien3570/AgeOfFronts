import { TICK_MS, type Snapshot } from "../Protocol";
import { TURN } from "../domain/FormationGeometry";

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
  }
  update(snapshot: Snapshot): void {
    const last = this.frames[this.frames.length - 1];
    if (last && snapshot.tick < last.tick) this.clear();
    if (!this.frames.length) this.tick = snapshot.tick;
    if (this.frames[this.frames.length - 1]?.tick === snapshot.tick)
      this.frames[this.frames.length - 1] = snapshot;
    else this.frames.push(snapshot);
    // An extended stall cannot retain an unbounded snapshot history.
    while (this.frames.length > 4) this.frames.shift();
    // Match the existing renderer's 600 ms catch-up bound for sparse updates.
    this.tick = Math.max(
      this.tick,
      this.frames[0].tick,
      snapshot.tick - 600 / TICK_MS,
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
    this.tick = paused
      ? latest.tick
      : Math.min(
          latest.tick,
          this.tick + (elapsed * Math.max(0, speed)) / TICK_MS,
        );
    while (this.frames.length > 1 && this.frames[1].tick <= this.tick)
      this.frames.shift();
    const source = this.frames[0],
      next = this.frames[1];
    let snapshot = source;
    if (next && this.tick > source.tick) {
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
      snapshot = {
        ...source,
        squads: source.squads.map((s) => {
          const target =
            targets.get(s.id) ??
            (terminalRoots.has(s.id)
              ? { ...s, ...terminalRoots.get(s.id)! }
              : undefined);
          if (!target) return s;
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
          if (s.x === target.x && s.y === target.y && formation === s.formation)
            return s;
          return {
            ...s,
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
