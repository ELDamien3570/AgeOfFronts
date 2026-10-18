import type { Building, BuildingType, Player } from "../Protocol";
import { buildingTechnology } from "../content/Buildings";
import { AGES, type Age, type ProgressionState, type Resource } from "./Definitions";

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

const PRODUCTION = new Set<BuildingType>([
  "city", "factory", "port", "blacksmith", "armory", "arms-factory",
  "barracks", "archery", "stables", "siege-workshop", "depot", "airstrip",
  "oil-well", "oil-rig", "nuclear-facility", "drone-facility", "missile-silo", "mirv-launcher",
]);
const DEFENSE = new Set<BuildingType>(["tower", "gun-nest", "trench", "missile-defence"]);

export const tribeProductionLimit = (age: Age): number => 2 * (AGES.indexOf(age) + 1);

export const TRIBE_BUILDING_ORDER: readonly BuildingType[] = [
  "city", "factory", "mine", "blacksmith", "armory", "arms-factory", "port",
  "barracks", "archery", "stables", "siege-workshop", "tower", "depot",
  "oil-well", "oil-rig", "gun-nest", "trench", "missile-defence", "airstrip",
  "missile-silo", "mirv-launcher", "nuclear-facility", "drone-facility",
];
/** Campaign procurement shares the same age-scaled production limits. */
export const TRIBE_MILITARY_BUILDING_ORDER: readonly BuildingType[] = [
  "barracks", "blacksmith", "armory", "arms-factory", "archery", "stables",
  "mine", "factory", "city", "siege-workshop", "depot", "port", "tower",
  "oil-well", "oil-rig", "gun-nest", "trench", "missile-defence", "airstrip",
  "missile-silo", "mirv-launcher", "nuclear-facility", "drone-facility",
];

/** Capability and copy limits are independent of affordability, technology
 * completion and placement, which remain ordinary command rules. */
export function tribeBuildingLimit(type: BuildingType, age: Age): number {
  if (!buildingTechnology(type, age)) return 0;
  return type === "mine" ? 2 : PRODUCTION.has(type) ? tribeProductionLimit(age) : DEFENSE.has(type) ? 2 : 1;
}

/** Call once when evaluating many candidate deposits; only actual mines count. */
export function tribeMineCounts(buildings: readonly Building[], resourceAt: (tile: number) => Resource | undefined): ReadonlyMap<Resource,number> {
  const counts = new Map<Resource,number>();
  for (const building of buildings) {
    if (building.type !== "mine") continue;
    const resource = resourceAt(building.tile);
    if (resource && resource !== "oil" && resource !== "horses") counts.set(resource,(counts.get(resource)??0)+1);
  }
  return counts;
}

/** Copy caps apply to new foundations only. Captured and restored buildings
 * remain intact, but count against future construction. Mines share a cap per
 * mineral resource across all sites; oil extractors are a different type. */
export function tribeBuildingRejection(
  player: Pick<Player, "id" | "kind">,
  type: BuildingType,
  tile: number,
  age: Age,
  buildings: readonly Building[],
  resourceAt: (tile: number) => Resource | undefined,
): string | null {
  if (player.kind !== "tribe") return null;
  const limit = tribeBuildingLimit(type, age);
  if (!limit) return "Tribes cannot build this structure in their current age";
  const own = buildings.filter(b => b.playerId === player.id && b.type === type);
  if (type === "mine") {
    const resource = resourceAt(tile);
    if (!resource || resource === "oil" || resource === "horses") return "Mines must be placed directly on a mineral deposit";
    if ((tribeMineCounts(own,resourceAt).get(resource) ?? 0) >= limit)
      return `Tribes can only build ${limit} mines for each mineral resource`;
  } else if (own.length >= limit) return `Tribes can only build ${limit} ${type}`;
  return null;
}
