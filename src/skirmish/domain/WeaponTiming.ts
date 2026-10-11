import type { AttackProfile } from "./Definitions";
export interface ChannelCycle {
  nextTick: number;
  remainder: number;
  shots: number;
  reloadStartedTick?: number;
}
export interface WeaponState {
  melee?: ChannelCycle;
  ranged?: ChannelCycle;
  sharedReadyTick: number;
}
/** No idle catch-up: ammunition and fractional cadence survive disengagement. */
export function commitWeaponShot(
  profile: AttackProfile,
  state: WeaponState | undefined,
  tick: number,
  moving: boolean,
): WeaponState | undefined {
  const cycle = state?.[profile.channel];
  if (tick < Math.max(state?.sharedReadyTick ?? 0, cycle?.nextTick ?? 0))
    return undefined;
  const rpm = profile.rpm!;
  const numerator = 1200 * (moving ? profile.movingReloadPercent : 100);
  const denominator = rpm * 100;
  const accumulated = numerator - (cycle?.remainder ?? 0);
  const interval = Math.max(1, Math.ceil(accumulated / denominator));
  const shots = (cycle?.shots ?? 0) + 1;
  const reload = shots >= (profile.shotsPerReload ?? 1);
  const reloadTicks = Math.ceil((profile.reloadMs ?? 0) / 50);
  return {
    ...state,
    sharedReadyTick: tick + interval,
    [profile.channel]: {
      nextTick: tick + Math.max(interval, reload ? reloadTicks : 0),
      remainder: interval * denominator - accumulated,
      shots: reload ? 0 : shots,
      ...(reload && reloadTicks ? { reloadStartedTick: tick } : {}),
    },
  };
}
export function sustainedInterval(profile: AttackProfile): number {
  if (!profile.perSoldier) return profile.reloadTicks;
  const interval = 1200 / profile.rpm!;
  const rounds = profile.shotsPerReload ?? 1;
  return (
    ((rounds - 1) * interval +
      Math.max(interval, Math.ceil((profile.reloadMs ?? 0) / 50))) /
    rounds
  );
}
export function validateWeaponState(value: WeaponState | undefined): void {
  if (value === undefined) return;
  const integer = (n: number, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(n) && n >= 0 && n <= max;
  if (!value || !integer(value.sharedReadyTick))
    throw new Error("Invalid weapon commitment");
  for (const channel of ["melee", "ranged"] as const) {
    const c = value[channel];
    if (
      c &&
      (!integer(c.nextTick) ||
        !integer(c.remainder, 120000) ||
        !integer(c.shots, 1000) ||
        (c.reloadStartedTick !== undefined && !integer(c.reloadStartedTick)))
    )
      throw new Error("Invalid weapon cycle");
  }
}
