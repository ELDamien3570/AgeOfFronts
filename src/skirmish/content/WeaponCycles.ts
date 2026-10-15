import { TICKS_PER_SECOND, TICK_MS, secondsToTicks } from '../Protocol';
import type { UnitDefinition } from "../domain/Definitions";

/** Compiled squad-level weapon timing. Renderers observe this state; clips never
 * trigger damage. Reloads survive order changes and target loss. */
export function weaponCycle(unit: Pick<UnitDefinition, "age" | "troopClass" | "rangedAttack">) {
  if (unit.rangedAttack) return { interval:(60*TICKS_PER_SECOND)/unit.rangedAttack.rpm!, reload:Math.ceil(unit.rangedAttack.reloadMs!/TICK_MS), rounds:unit.rangedAttack.shotsPerReload! };
  const cls = unit.troopClass;
  const gun =
    unit.age === "Napoleonic" &&
    ["frontline", "rangedInfantry", "rangedCavalry"].includes(cls ?? "");
  const rifle =
    ["EarlyModern", "Modern"].includes(unit.age) &&
    ["frontline", "rangedInfantry"].includes(cls ?? "");
  if (rifle) return { interval: secondsToTicks(1), reload: secondsToTicks(3), rounds: 3 };
  if (gun) return { interval: secondsToTicks(6), reload: secondsToTicks(6), rounds: 1 };
  if (cls === "rangedInfantry" || cls === "rangedCavalry")
    return {
      interval: unit.age === "LateMedieval" ? secondsToTicks(4) : secondsToTicks(2.5),
      reload: unit.age === "LateMedieval" ? secondsToTicks(4) : secondsToTicks(2.5),
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
