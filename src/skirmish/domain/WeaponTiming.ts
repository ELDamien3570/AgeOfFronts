import { TICKS_PER_SECOND, TICK_MS } from '../Protocol';
import type { AttackProfile } from "./Definitions";
export interface ChannelCycle {
  nextTick: number;
  remainder: number;
  shots: number;
  lastShotTick?: number;
  reloadStartedTick?: number;
}
export interface WeaponState {
  melee?: ChannelCycle;
  ranged?: ChannelCycle;
  sharedReadyTick: number;
  rangedSequence?: number;
  rangedAction?: RangedAction;
}
export interface RangedAction {
  sequence: number;
  definitionId: string;
  targetKind: "squad" | "aircraft" | "building" | "barrier";
  targetId: number;
  startTick: number;
  releaseTick: number;
  lastEligibleTick: number;
  phase: "preparing" | "sustaining" | "released";
}
/** No idle catch-up: ammunition and fractional cadence survive disengagement. */
export function commitWeaponShot(
  profile: AttackProfile,
  state: WeaponState | undefined,
  tick: number,
  moving: boolean,
  independentChannels = false,
): WeaponState | undefined {
  const cycle = state?.[profile.channel];
  if (
    tick <
    Math.max(
      independentChannels || cycle?.lastShotTick === tick ? 0 : (state?.sharedReadyTick ?? 0),
      cycle?.nextTick ?? 0,
    )
  )
    return undefined;
  const rpm = profile.rpm!;
  const numerator = (60 * TICKS_PER_SECOND) * (moving ? profile.movingReloadPercent : 100);
  const denominator = rpm * 100;
  const accumulated = numerator - (cycle?.remainder ?? 0);
  const interval = Math.max(0, Math.ceil(accumulated / denominator));
  const shots = (cycle?.shots ?? 0) + 1;
  const reload = shots >= (profile.shotsPerReload ?? 1);
  const reloadTicks = Math.ceil((profile.reloadMs ?? 0) / TICK_MS);
  return {
    ...state,
    sharedReadyTick: tick + Math.max(1, interval),
    [profile.channel]: {
      nextTick: tick + Math.max(interval, reload ? reloadTicks : 0),
      remainder: interval * denominator - accumulated,
      shots: reload ? 0 : shots,
      lastShotTick: tick,
      ...(reload && reloadTicks ? { reloadStartedTick: tick } : {}),
    },
  };
}
export function sustainedInterval(profile: AttackProfile): number {
  if (!profile.perSoldier) return profile.reloadTicks;
  const interval = (60 * TICKS_PER_SECOND) / profile.rpm!;
  const rounds = profile.shotsPerReload ?? 1;
  return (
    ((rounds - 1) * interval +
      Math.max(interval, Math.ceil((profile.reloadMs ?? 0) / TICK_MS))) /
    rounds
  );
}
export function validateWeaponState(value: WeaponState | undefined, tick?: number): void {
  if (value === undefined) return;
  const integer = (n: number, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(n) && n >= 0 && n <= max;
  if (!value || !integer(value.sharedReadyTick))
    throw new Error("Invalid weapon commitment");
  if (value.rangedSequence !== undefined && !integer(value.rangedSequence))
    throw new Error("Invalid ranged sequence");
  const action = value.rangedAction;
  if (action === null) throw new Error("Invalid ranged preparation");
  if (action && (!integer(action.sequence) || action.sequence < 1 || action.sequence !== value.rangedSequence ||
    typeof action.definitionId !== "string" || !action.definitionId.length || action.definitionId.length > 128 ||
    !["squad", "aircraft", "building", "barrier"].includes(action.targetKind) || !integer(action.targetId) ||
    !integer(action.startTick) || !integer(action.releaseTick) || action.releaseTick <= action.startTick ||
    !integer(action.lastEligibleTick) || action.lastEligibleTick < action.startTick ||
    !["preparing", "sustaining", "released"].includes(action.phase) ||
    action.releaseTick - action.startTick > 60*TICKS_PER_SECOND ||
    (tick !== undefined && (action.startTick > tick || action.lastEligibleTick > tick)) ||
    (action.phase !== "preparing" && action.lastEligibleTick < action.releaseTick)))
    throw new Error("Invalid ranged preparation");
  for (const channel of ["melee", "ranged"] as const) {
    const c = value[channel];
    if (
      c &&
      (!integer(c.nextTick) ||
        !integer(c.remainder, 120000) ||
        !integer(c.shots, 1000) ||
        (c.lastShotTick !== undefined && !integer(c.lastShotTick)) ||
        (c.reloadStartedTick !== undefined && !integer(c.reloadStartedTick)))
    )
      throw new Error("Invalid weapon cycle");
  }
}
