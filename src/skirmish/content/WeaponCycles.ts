import type { UnitDefinition } from "../domain/Definitions";

/** Compiled squad-level weapon timing. Renderers observe this state; clips never
 * trigger damage. Reloads survive order changes and target loss. */
export function weaponCycle(unit: Pick<UnitDefinition, "age" | "troopClass">) {
  const cls = unit.troopClass;
  const gun =
    unit.age === "Napoleonic" &&
    ["frontline", "rangedInfantry", "rangedCavalry"].includes(cls ?? "");
  const rifle =
    ["EarlyModern", "Modern"].includes(unit.age) &&
    ["frontline", "rangedInfantry"].includes(cls ?? "");
  if (rifle) return { interval: 20, reload: 60, rounds: 3 };
  if (gun) return { interval: 120, reload: 120, rounds: 1 };
  if (cls === "rangedInfantry" || cls === "rangedCavalry")
    return {
      interval: unit.age === "LateMedieval" ? 80 : 50,
      reload: unit.age === "LateMedieval" ? 80 : 50,
      rounds: 1,
    };
  return undefined;
}
export function afterWeaponShot(
  unit: UnitDefinition,
  shots: number,
  tick: number,
  interval: number,
) {
  const cycle = weaponCycle(unit);
  if (!cycle || cycle.rounds === 1)
    return {
      magazineShots: 0,
      reloadStartedTick: cycle ? tick : undefined,
      nextAttackTick: tick + interval,
    };
  const used = shots + 1;
  return used >= cycle.rounds
    ? {
        magazineShots: 0,
        reloadStartedTick: tick,
        nextAttackTick: tick + Math.max(interval, cycle.reload),
      }
    : {
        magazineShots: used,
        reloadStartedTick: undefined,
        nextAttackTick: tick + interval,
      };
}
