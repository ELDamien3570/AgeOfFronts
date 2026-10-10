import type { BuildingType } from "../Protocol";
import { BUILDING_RULES } from "../Rules";
import { AGES, type Age, type Cost } from "../domain/Definitions";
import { RUSSIAN_RECRUITMENT } from "./RussianRecruitment";
export const DEFENSIVE_BUILDINGS: readonly BuildingType[] = [
  "tower",
  "gun-nest",
  "trench",
  "missile-defence",
  "anti-air-emplacement",
];
/** Packaged building research upgrades existing infrastructure automatically. */
export const AUTOMATIC_TIER_BUILDINGS: readonly BuildingType[] = [
  "city",
  "factory",
  "mine",
  "oil-well",
  "oil-rig",
  "nuclear-facility",
  "drone-facility",
  "anti-air-emplacement",
  "port",
  "barracks",
  "archery",
  "stables",
  "tower",
  "blacksmith",
  "armory",
  "arms-factory",
  "siege-workshop",
  "depot",
  "airstrip",
  "gun-nest",
  "trench",
  "missile-silo",
  "mirv-launcher",
  "missile-defence",
];
export function automaticBuildingTier(
  type: BuildingType,
  playerAge: Age,
  completed: readonly string[],
): Age | undefined {
  if (!AUTOMATIC_TIER_BUILDINGS.includes(type)) return undefined;
  return [...AGES]
    .reverse()
    .find(
      (age) =>
        AGES.indexOf(age) <= AGES.indexOf(playerAge) &&
        !!buildingTechnology(type, age) &&
        completed.includes(
          type === "city" && age === "StoneAge"
            ? "rus-stoneage-cities"
            : buildingTechnology(type, age)!,
        ),
    );
}
/** Armory is one physical production line; research promotes it in place. */
export function productionBuildingType(type: BuildingType, age: Age, completed: readonly string[]): BuildingType {
  return type === "armory" && automaticBuildingTier("arms-factory", age, completed) ? "arms-factory" : type;
}
export function buildingFoundationTechnology(
  type: BuildingType,
  age: Age,
): string | null {
  if (type === "city" && age === "StoneAge")
    return "rus-stoneage-cities";
  const bindings = RUSSIAN_RECRUITMENT.buildings as Record<string, string>;
  if (
    AGES.indexOf(age) >= 6 &&
    ["oil-well", "oil-rig", "nuclear-facility"].includes(type)
  )
    return (
      bindings[`${age}:${type}`] ?? bindings[`EarlyModern:${type}`] ?? null
    );
  return bindings[`${age}:${type}`] ?? null;
}
export function buildingTechnology(
  type: BuildingType,
  age: Age,
): string | null {
  return buildingFoundationTechnology(type, age);
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
export function buildingIntegrity(
  type: BuildingType,
  age: Age,
  research: readonly string[] = [],
): number {
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
