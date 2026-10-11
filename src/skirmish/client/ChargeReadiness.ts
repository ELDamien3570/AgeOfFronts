import { UNIT } from "../content/Units";
import type { Squad } from "../Protocol";
import { isCavalryTroopClass } from '../domain/Definitions';
import { recoveredChargeStrength } from '../domain/ChargeStrength';

type ChargeView = Pick<Squad, "definitionId" | "charge" | "chargeReadyTick" | "afloat" | "refit" | "x" | "y">;

/** The squad's charge attack, or undefined for units that cannot charge. */
export function chargeProfile(squad: Pick<Squad, "definitionId">) {
  return UNIT.get(squad.definitionId ?? "")?.charge;
}

/** Impact stamina, independent of mounted rush command availability. */
export function chargeReadiness(squad: ChargeView, tick: number): number | undefined {
  const profile = chargeProfile(squad);
  if (!profile) return undefined;
  if (squad.charge) return 0;
  return recoveredChargeStrength(squad.chargeReadyTick,tick,profile.cooldownTicks);
}

/** Whether this squad would be admitted to a charge at the given point now. */
export function canCharge(squad: ChargeView, tick: number, x: number, y: number): boolean {
  const profile = chargeProfile(squad);
  const mounted=isCavalryTroopClass(UNIT.get(squad.definitionId??'')?.troopClass);
  return !!profile && (mounted || chargeReadiness(squad, tick) === 1) && !squad.afloat && !squad.refit &&
    Math.hypot(squad.x - x, squad.y - y) <= profile.maximumDistance;
}
