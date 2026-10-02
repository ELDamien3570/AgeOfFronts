import type { Building } from "../Protocol";
import { buildingIntegrity, buildingTechnology } from "../content/Buildings";
import { AGES, type ProgressionState } from "./Definitions";

export const MILITARY_BUILDINGS = [
  "barracks",
  "archery",
  "stables",
  "siege-workshop",
  "tower",
  "port",
  "airstrip",
  "blacksmith",
  "armory",
  "arms-factory",
  "depot",
  "gun-nest",
  "trench",
  "missile-silo",
  "mirv-launcher",
  "missile-defence",
] as const satisfies readonly Building["type"][];

/** Infrastructure follows the current owner's earned unlocks, including captures
 * and construction completed after research. Upgrading never repairs damage,
 * transforms a building into a different type, or upgrades an attached wall. */
export function modernizeMilitaryBuildings(
  buildings: readonly Building[],
  states: Readonly<Record<number, ProgressionState>>,
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
        [...AGES].reverse().find((age) => {
          const technology = buildingTechnology(building.type, age);
          return (
            AGES.indexOf(age) <= AGES.indexOf(state.age) &&
            !!technology &&
            state.completed.includes(technology)
          );
        }),
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
    building.age = age;
    building.maxHealth = buildingIntegrity(building.type, age);
    building.health = Math.max(1, Math.floor(building.maxHealth * ratio));
  }
}
