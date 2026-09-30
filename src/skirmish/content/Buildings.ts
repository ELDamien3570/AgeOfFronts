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
  if (type === "port") return technologyAt(age, "naval", 1).id;
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
export function buildingCost(type: BuildingType, age: Age): Cost {
  const index = AGES.indexOf(age),
    cost = BUILDING_RULES[type].cost * (1 + index);
  const items: Cost["items"] =
    type === "tower" && index
      ? { stone: 10 * index }
      : [
            "gun-nest",
            "missile-defence",
            "missile-silo",
            "mirv-launcher",
          ].includes(type)
        ? { steel: 40 }
        : undefined;
  return { gold: cost, items };
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
