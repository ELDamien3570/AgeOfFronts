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
