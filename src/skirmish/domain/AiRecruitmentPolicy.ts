import { UNITS } from "../content/Units";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import { AGES, type UnitDefinition } from "./Definitions";

/** Equipment demand describes the intended force, independently of today's
 * stock or workshops. Otherwise a missing kit erases the demand to make it. */
export function preferredRecruitmentUnit(
  snapshot: AiEconomicSnapshot,
  role: UnitDefinition["role"],
): UnitDefinition | undefined {
  return [...UNITS]
    .reverse()
    .find(
      (unit) =>
        unit.role === role &&
        snapshot.research.includes(unit.technologyId) &&
        AGES.indexOf(unit.age) <= AGES.indexOf(snapshot.age),
    );
}

/** A nearby older tier can bridge a shortage. Severely obsolete recruits are
 * a survival purchase only, when the observed enemy outmatches the ready army.
 * Relative tiers keep this policy applicable to every age and troop role. */
export function recruitmentTierAllowed(
  snapshot: AiEconomicSnapshot,
  unit: UnitDefinition,
): boolean {
  const tier = AGES.indexOf(snapshot.age);
  return (
    tier - AGES.indexOf(unit.age) <= 1 ||
    snapshot.threatTroops > snapshot.readyTroops * 1.5
  );
}
