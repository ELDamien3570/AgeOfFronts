import type { AttackProfile } from "./Definitions";
import type { RangedAction, WeaponState } from "./WeaponTiming";

export type RangedTarget = Pick<RangedAction, "targetKind" | "targetId">;

/** Cancellation never resets ammunition or the existing cooldown. A released
 * commitment remains as bounded history for coalesced presentation snapshots. */
export function cancelRangedPreparation(
  state: WeaponState | undefined,
): WeaponState | undefined {
  if (!state?.rangedAction || state.rangedAction.phase === "released")
    return state;
  return {
    ...state,
    rangedAction:
      state.rangedAction.phase === "sustaining"
        ? { ...state.rangedAction, phase: "released" }
        : undefined,
  };
}

export function prepareRangedShot(
  state: WeaponState | undefined,
  profile: AttackProfile,
  definitionId: string,
  target: RangedTarget,
  tick: number,
  readyTick: number,
): { state: WeaponState; ready: boolean } {
  const base = state ?? { sharedReadyTick: 0 };
  const timing = profile.preparation!;
  const old = base.rangedAction;
  const same =
    old?.definitionId === definitionId &&
    old.targetKind === target.targetKind &&
    old.targetId === target.targetId;
  if (same && old.phase !== "released" && old.lastEligibleTick >= tick - 1) {
    const action = { ...old, lastEligibleTick: tick };
    return {
      state: { ...base, rangedAction: action },
      ready: tick >= action.releaseTick && tick >= readyTick,
    };
  }
  // A new aim must fit in full. Retargets cannot inherit the previous aim or
  // move a nearly completed wind-up to a different opponent.
  const cancelled = cancelRangedPreparation(base)!;
  if (tick < readyTick - timing.ticks)
    return { state: cancelled, ready: false };
  const sequence = (base.rangedSequence ?? 0) + 1;
  return {
    state: {
      ...base,
      rangedSequence: sequence,
      rangedAction: {
        ...target,
        definitionId,
        sequence,
        startTick: tick,
        releaseTick: Math.max(readyTick, tick + timing.ticks),
        lastEligibleTick: tick,
        phase: "preparing",
      },
    },
    ready: false,
  };
}

export function releaseRangedShot(
  state: WeaponState,
  profile: AttackProfile,
  tick: number,
): WeaponState {
  const action = state.rangedAction!;
  const cycle = state.ranged;
  const reloading = cycle?.reloadStartedTick === tick;
  return {
    ...state,
    rangedAction: {
      ...action,
      lastEligibleTick: tick,
      phase:
        profile.preparation!.automatic && !reloading
          ? "sustaining"
          : "released",
    },
  };
}

/** N10 (owner decision D8, wire-only): how long a released ranged action stays
 * in replicated detail rows after its last eligible tick. Twice the client's
 * combat presentation delay (4 ticks), so a coalesced presentation endpoint
 * still sees the release. The simulation keeps the action unchanged. */
export const RANGED_HISTORY_TICKS = 8;
const prunedWeaponStates = new WeakMap<WeaponState, WeaponState>();
/** The weapon state as replicated at `tick`: a released action older than
 * RANGED_HISTORY_TICKS is omitted. The pruned copy is memoised per source
 * object, so encoder caches keyed by identity re-encode a row exactly once
 * when it expires. Never feed the result back into the simulation. */
export function replicatedWeaponState(
  state: WeaponState | undefined,
  tick: number | undefined,
): WeaponState | undefined {
  const action = state?.rangedAction;
  if (!state || !action || action.phase !== "released" || tick === undefined) return state;
  if (tick - Math.max(action.releaseTick, action.lastEligibleTick) <= RANGED_HISTORY_TICKS) return state;
  let pruned = prunedWeaponStates.get(state);
  if (!pruned) {
    const { rangedAction: _expired, ...rest } = state;
    pruned = rest;
    prunedWeaponStates.set(state, pruned);
  }
  return pruned;
}
