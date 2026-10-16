import type { AttackProfile } from "../../domain/Definitions";
import { TICK_MS, type ArcherVolley, type Snapshot } from "../../Protocol";
import { clipFrame, type ActorClip } from "./TroopFormationModel";
import { javelinThrowTime, throwTiming } from "./TroopVolley";

/** One cosmetic burst clock per squad. No gameplay state or soldier controllers. */
export class RangedAttackPresentation {
  private readonly bursts = new Map<number, { first: number; last: number }>();
  private readonly shots = new Map<number, number[]>();
  private readonly admitted = new Map<
    number,
    { sequence: number; allowed: boolean }
  >();
  permitsRelease(id: number): boolean {
    return this.admitted.get(id)?.allowed ?? true;
  }
  clear(): void {
    this.bursts.clear();
    this.shots.clear();
    this.admitted.clear();
  }
  observe(facts: readonly ArcherVolley[]): void {
    this.shots.clear();
    for (const fact of facts) {
      if (fact.melee || fact.impact || fact.sourceKind === "aircraft") continue;
      let ticks = this.shots.get(fact.squadId);
      if (!ticks) this.shots.set(fact.squadId, (ticks = []));
      ticks.push(fact.tick);
    }
    for (const ticks of this.shots.values()) ticks.sort((a, b) => a - b);
  }
  prune(ids: ReadonlySet<number>): void {
    for (const id of this.bursts.keys())
      if (!ids.has(id)) this.bursts.delete(id);
    for (const id of this.admitted.keys())
      if (!ids.has(id)) this.admitted.delete(id);
  }
  sample(
    squad: Snapshot["squads"][number],
    tick: number,
    clip: ActorClip,
    intervalMs: number,
    preparation?: AttackProfile["preparation"],
  ): number | undefined {
    const cycle = squad.weaponState?.ranged;
    const meleeLast =
      squad.meleeStrike &&
      squad.meleeStrike.tick >= (squad.lastAttackTick ?? -Infinity);
    const shot =
      cycle?.lastShotTick ?? (meleeLast ? undefined : squad.lastAttackTick);
    const source = cycle
      ? { ...squad, lastAttackTick: shot, nextAttackTick: cycle.nextTick }
      : squad;
    const timing = throwTiming(clip);
    const recovery = timing.duration - timing.release;
    if (preparation) {
      const action = squad.weaponState?.rangedAction;
      if (
        action &&
        tick >= action.startTick &&
        this.admitted.get(squad.id)?.sequence !== action.sequence
      ) {
        const time =
          (timing.release * (tick - action.startTick)) /
          (action.releaseTick - action.startTick);
        // A late asset decode, visibility change or long stall must not invent
        // a partial wind-up followed by a fresh release. Join the next sequence.
        this.admitted.set(squad.id, {
          sequence: action.sequence,
          allowed: tick < action.releaseTick && clipFrame(clip, time) === 0,
        });
      }
      if (!this.permitsRelease(squad.id)) return undefined;
      if (action && tick >= action.startTick && tick < action.releaseTick)
        return (
          (timing.release * (tick - action.startTick)) /
          (action.releaseTick - action.startTick)
        );
      const since = (tick - (shot ?? -Infinity)) * TICK_MS;
      if (
        action?.phase === "sustaining" &&
        shot !== undefined &&
        tick >= action.releaseTick &&
        since >= 0 &&
        since < Math.max(TICK_MS, intervalMs) * 1.5
      )
        return (
          timing.release + (((tick - action.releaseTick) * TICK_MS) % recovery)
        );
      // Readiness is no longer a promise that an attack will happen. Without
      // an announced preparation or an actual released shot, remain idle.
      return since >= 0 && since < recovery
        ? timing.release + since
        : undefined;
    }
    if (
      shot === undefined ||
      !Number.isFinite(intervalMs) ||
      intervalMs >= recovery
    )
      return javelinThrowTime(source, tick, clip);
    let burst = this.bursts.get(squad.id);
    const tolerance = Math.max(intervalMs * 1.5, TICK_MS * 1.5);
    // Retained shot facts bridge coalesced publications. The latest timestamp
    // alone cannot distinguish a continuous burst from a genuine interruption.
    for (const released of [...(this.shots.get(squad.id) ?? []), shot]) {
      if (
        released > shot ||
        (burst && released <= burst.last && shot >= burst.last)
      )
        continue;
      if (
        !burst ||
        released < burst.last ||
        (released - burst.last) * TICK_MS > tolerance
      )
        burst = { first: released, last: released };
      else burst.last = released;
    }
    burst ??= { first: shot, last: shot };
    this.bursts.set(squad.id, burst);
    const since = (tick - shot) * TICK_MS;
    if (since < 0 || since >= tolerance)
      return javelinThrowTime(source, tick, clip);
    // A continuous firing loop advances across shots instead of resetting the
    // release frame every 100 ms. Individual shot effects still use shot ticks.
    return timing.release + (((tick - burst.first) * TICK_MS) % recovery);
  }
}

/** Locomotion may translate a firing rider but must not replace its attack. */
export function rangedRecoveryClip(
  clip: string,
  recovering: boolean,
  moving: boolean,
  strike: boolean,
): string {
  return recovering && !strike && clip !== "attack" && clip !== "reload"
    ? moving
      ? "running"
      : "idle"
    : clip;
}
