import type { AttackProfile, UnitDefinition } from "../domain/Definitions";
import { secondsToTicks } from "../Protocol";
import catalogue from "./unit-tuning.json";

type Tuning = Pick<UnitDefinition, "speedPercent"> &
  Partial<Pick<UnitDefinition, "meleeArmour" | "rangedArmour" | "armourKind">> & {
    attack?: Partial<AttackProfile>;
    reloadSeconds?: number;
  };

/** Authored hull and movement values. Manpower and soldier weapons have their
 * own canonical catalogues; this does not load runtime lab drafts. */
export function applyUnitTuning(unit: UnitDefinition): void {
  const data = (catalogue.units as Record<string, Tuning>)[unit.id];
  if (!data) throw new Error(`Missing unit tuning ${unit.id}`);
  const { attack, reloadSeconds, ...stats } = data;
  Object.assign(unit, stats);
  if (attack) unit.attack = { ...unit.attack, ...attack };
  if (reloadSeconds !== undefined) unit.attack.reloadTicks = secondsToTicks(reloadSeconds);
}
