import { scaledAttack } from "../domain/Combat";
import type { UnitDefinition } from "../domain/Definitions";
/** The same authored profiles used by combat; all damage values are per soldier. */
export function soldierWeaponStats(
  unit: UnitDefinition,
  xp = 0,
): [string, string][] {
  const melee =
    unit.meleeAttack && scaledAttack(unit.meleeAttack, 1000, 1000, xp);
  const ranged =
    unit.rangedAttack && scaledAttack(unit.rangedAttack, 1000, 1000, xp);
  return [
    ["Melee damage per attack", String(melee?.damage ?? 0)],
    ["Ranged damage per attack", String(ranged?.damage ?? 0)],
    ["Shots per reload", ranged ? String(ranged.shotsPerReload) : "—"],
    ["RPM", ranged ? String(ranged.rpm) : "—"],
    ["Melee attacks per minute", String(melee?.rpm ?? 0)],
    ["Reload speed", ranged ? `${ranged.reloadMs! / 1000}s` : "—"],
    [
      "Charge multiplier",
      unit.charge ? `${unit.chargeMultiplier ?? 1}× melee at impact` : "1×",
    ],
  ];
}
