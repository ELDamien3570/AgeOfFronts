import type { BuildingType, Player } from "../Protocol";
import { buildingTechnology } from "../content/Buildings";
import { AGES, type Age, type ProgressionState } from "./Definitions";

export const TRIBE_ADVANCE_PERCENT = 75;

/** Unlock only; ordinary research, payment and advancement jobs still apply. */
export function tribeAdvanceRejection(player: Player, players: readonly Player[], states: Record<number, ProgressionState>): string | null {
  if (player.kind !== "tribe") return null;
  const next = AGES.indexOf(states[player.id].age) + 1;
  if (next >= AGES.length) return null;
  const survivors = players.filter(p => p.kind !== "tribe" && !p.eliminated);
  const required = Math.ceil(survivors.length * TRIBE_ADVANCE_PERCENT / 100);
  const advanced = survivors.filter(p => AGES.indexOf(states[p.id].age) >= next).length;
  return survivors.length && advanced >= required
    ? null : "75% of surviving non-tribe factions must reach the next age first";
}

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
