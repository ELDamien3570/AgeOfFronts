import { UNIT } from "../content/Units";
import type { Squad } from "../Protocol";

type ChargeView = Pick<Squad, "definitionId" | "charge" | "chargeReadyTick" | "afloat" | "refit" | "x" | "y">;

/** The squad's charge attack, or undefined for units that cannot charge. */
export function chargeProfile(squad: Pick<Squad, "definitionId">) {
  return UNIT.get(squad.definitionId ?? "")?.charge;
}

/** Recovered fraction of the charge cooldown: 1 is ready, 0 is spent or in
 * progress; undefined for units without a charge attack. Mirrors the
 * authoritative rule (a charge needs no active charge and a passed
 * chargeReadyTick). */
export function chargeReadiness(squad: ChargeView, tick: number): number | undefined {
  const profile = chargeProfile(squad);
  if (!profile) return undefined;
  if (squad.charge) return 0;
  const remaining = Math.max(0, (squad.chargeReadyTick ?? 0) - tick);
  return 1 - Math.min(1, remaining / Math.max(1, profile.cooldownTicks));
}

/** Whether this squad would be admitted to a charge at the given point now. */
export function canCharge(squad: ChargeView, tick: number, x: number, y: number): boolean {
  const profile = chargeProfile(squad);
  return !!profile && chargeReadiness(squad, tick) === 1 && !squad.afloat && !squad.refit &&
    Math.hypot(squad.x - x, squad.y - y) <= profile.maximumDistance;
}
