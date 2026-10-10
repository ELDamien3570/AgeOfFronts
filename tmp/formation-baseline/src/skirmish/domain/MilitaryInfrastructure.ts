import type { Building } from "../Protocol";
import { AUTOMATIC_TIER_BUILDINGS, automaticBuildingTier, buildingIntegrity } from "../content/Buildings";
import { AGES, type ProgressionState } from "./Definitions";

export const MILITARY_BUILDINGS = AUTOMATIC_TIER_BUILDINGS;

/** Infrastructure follows the current owner's earned unlocks, including captures
 * and construction completed after research. Upgrading never repairs damage,
 * transforms a building into a different type, or upgrades an attached wall. */
export function modernizeMilitaryBuildings(
  buildings: readonly Building[],
  states: Readonly<Record<number, ProgressionState>>,
  updateBuilding: (id: number, changes: Partial<Omit<Building, "id">>) => void,
): void {
  const targets = new Map<string, (typeof AGES)[number] | undefined>();
  for (const building of buildings) {
    if (
      building.remainingTicks ||
      (building.health ?? 1) <= 0 ||
      !MILITARY_BUILDINGS.some((type) => type === building.type)
    )
      continue;
    const state = states[building.playerId];
    if (!state) continue;
    const key = `${building.playerId}:${building.type}`;
    if (!targets.has(key))
      targets.set(
        key,
        automaticBuildingTier(building.type, state.age, state.completed),
      );
    const age = targets.get(key);
    const previousAge = building.age ?? "StoneAge";
    if (!age || AGES.indexOf(age) <= AGES.indexOf(previousAge)) continue;
    const previousMaximum =
      building.maxHealth ?? buildingIntegrity(building.type, previousAge);
    const ratio = Math.min(
      1,
      (building.health ?? previousMaximum) / previousMaximum,
    );
    const maxHealth = buildingIntegrity(building.type, age);
    updateBuilding(building.id, { age, maxHealth,
      health: Math.max(1, Math.floor(maxHealth * ratio)) });
  }
}
