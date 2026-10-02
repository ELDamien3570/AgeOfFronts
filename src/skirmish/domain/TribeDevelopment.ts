import type { BuildingType } from "../Protocol";
import { buildingTechnology } from "../content/Buildings";
import type { Age } from "./Definitions";

const MILITARY = new Set<BuildingType>([
  "barracks", "archery", "stables", "siege-workshop", "tower", "gun-nest",
  "trench", "missile-defence", "missile-silo", "mirv-launcher", "airstrip",
]);

export const TRIBE_BUILDING_ORDER: readonly BuildingType[] = [
  "city", "factory", "mine", "blacksmith", "armory", "arms-factory", "port",
  "barracks", "archery", "stables", "siege-workshop", "tower", "depot",
  "oil-well", "oil-rig", "gun-nest", "trench", "missile-defence", "airstrip",
  "missile-silo", "mirv-launcher",
];

/** Capability and copy limits are independent of affordability, technology
 * completion and placement, which remain ordinary command rules. */
export function tribeBuildingLimit(type: BuildingType, age: Age): number {
  return buildingTechnology(type, age) ? MILITARY.has(type) ? 2 : 1 : 0;
}
