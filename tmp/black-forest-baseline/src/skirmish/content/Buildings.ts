import type { BuildingType } from "../Protocol";
import { BUILDING_RULES } from "../Rules";
import { AGES, type Age, type Cost } from "../domain/Definitions";
import { technologyAt } from "./Technology";
export const DEFENSIVE_BUILDINGS: readonly BuildingType[] = [
  "tower",
  "gun-nest",
  "trench",
  "missile-defence",
];
/** Production/defence tiers follow researched military or naval technology.
 * Economic infrastructure retains its distinct paid upgrades. */
export const AUTOMATIC_TIER_BUILDINGS: readonly BuildingType[] = [
  "port", "barracks", "archery", "stables", "tower", "blacksmith",
  "armory", "arms-factory", "siege-workshop", "depot", "airstrip", "gun-nest",
  "trench", "missile-silo", "mirv-launcher", "missile-defence",
];
export function automaticBuildingTier(type: BuildingType, playerAge: Age, completed: readonly string[]): Age | undefined {
  if (!AUTOMATIC_TIER_BUILDINGS.includes(type)) return undefined;
  return [...AGES].reverse().find(age => AGES.indexOf(age) <= AGES.indexOf(playerAge) &&
    !!buildingTechnology(type, age) && completed.includes(buildingTechnology(type, age)!));
}
export function buildingTechnology(
  type: BuildingType,
  age: Age,
): string | null {
  const index = AGES.indexOf(age);
  if (
    (type === "blacksmith" && (index < 1 || index > 4)) ||
    (type === "armory" && index !== 5) ||
    ([
      "depot",
      "arms-factory",
      "airstrip",
      "oil-well",
      "oil-rig",
      "gun-nest",
      "trench",
      "missile-silo",
      "mirv-launcher",
      "missile-defence",
    ].includes(type) &&
      index !== 6)
  )
    return null;
  if (type === "port") return age === "StoneAge" ? "stoneage-shorecraft" : technologyAt(age, "naval", 1).id;
  if (type === "city")
    return technologyAt(
      age,
      "economic",
      index === 0 ? 1 : index === 3 ? 1 : index === 4 ? 3 : 2,
    ).id;
  if (type === "factory")
    return technologyAt(age, "economic", index === 0 ? 2 : index === 4 ? 3 : 2)
      .id;
  if (type === "mine")
    return technologyAt(age, "economic", index === 0 ? 3 : 1).id;
  if (type === "oil-well" || type === "oil-rig")
    return technologyAt(age, "economic", 1).id;
  if (
    type === "barracks" ||
    type === "blacksmith" ||
    type === "armory" ||
    type === "arms-factory"
  )
    return technologyAt(age, "warfare", 1).id;
  if (
    type === "archery" ||
    type === "depot" ||
    type === "gun-nest" ||
    type === "trench" ||
    type === "missile-defence"
  )
    return technologyAt(age, "warfare", 2).id;
  if (type === "stables")
    return index === 6 ? null : technologyAt(age, "warfare", 3).id;
  if (type === "airstrip") return technologyAt(age, "warfare", 3).id;
  if (type === "siege-workshop")
    return technologyAt(age, "warfare", index > 1 ? 2 : 4).id;
  if (type === "tower")
    return index === 6 ? null : technologyAt(age, "warfare", 4).id;
  return technologyAt(age, "warfare", 4).id;
}
export function buildingCostMultiplier(existingCount = 0): number {
  return Math.min(4, 1 + Math.max(0, existingCount) * 0.3);
}

export function buildingTicks(type: BuildingType, existingCount = 0): number {
  return Math.round(
    BUILDING_RULES[type].ticks * buildingCostMultiplier(existingCount),
  );
}

export function buildingCost(
  type: BuildingType,
  age: Age,
  existingCount = 0,
): Cost {
  const index = AGES.indexOf(age),
    multiplier = buildingCostMultiplier(existingCount),
    cost = Math.round(BUILDING_RULES[type].cost * (1 + index) * multiplier);
  const items: Cost["items"] =
    type === "tower" && index
      ? { stone: Math.round(10 * index * multiplier) }
      : [
            "gun-nest",
            "missile-defence",
            "missile-silo",
            "mirv-launcher",
          ].includes(type)
        ? { steel: Math.round(40 * multiplier) }
        : undefined;
  return { gold: cost, items };
}
/** A paid upgrade advances one catalogue tier; it never jumps missing tiers. */
export function nextBuildingAge(type: BuildingType, currentAge: Age, playerAge: Age, completedTechs: readonly string[]): Age | null {
  if (AUTOMATIC_TIER_BUILDINGS.includes(type)) return null;
  const next = AGES[AGES.indexOf(currentAge) + 1];
  if (!next || AGES.indexOf(next) > AGES.indexOf(playerAge)) return null;
  const technology = buildingTechnology(type, next);
  return technology && completedTechs.includes(technology) ? next : null;
}
export function buildingUpgradeCost(type: BuildingType, nextAge: Age, existingCount = 0): Cost {
  const full = buildingCost(type, nextAge, existingCount);
  return { gold: Math.round((full.gold ?? 0) / 2),
    items: Object.fromEntries(Object.entries(full.items ?? {}).map(([id, n]) => [id, Math.ceil(n / 2)])) };
}
export function buildingIntegrity(type: BuildingType, age: Age): number {
  return Math.round(
    (type === "tower" ? 2000 : type === "trench" ? 1500 : 1200) *
      1.3 ** AGES.indexOf(age),
  );
}
export function producerCompatible(
  actual: BuildingType,
  required: BuildingType,
): boolean {
  return (
    actual === required ||
    (actual === "armory" && required === "blacksmith") ||
    (actual === "arms-factory" &&
      (required === "blacksmith" || required === "armory"))
  );
}
