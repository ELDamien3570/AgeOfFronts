import type { Building, Player } from "../Protocol";
import { AUTOMATIC_TIER_BUILDINGS, buildingIntegrity, buildingTechnology, buildingTicks, buildingUpgradeCost, nextBuildingAge } from "../content/Buildings";
import { AGES, type Age, type Cost, type Inventory, type ProgressionState } from "./Definitions";
import { costRejection } from "./Supply";

export interface BuildingUpgrade {
  building: Building;
  age: Age;
  cost: Cost;
  ticks: number;
}

/** Shared preview/authority quote. Validate every identity, then pay once for
 * the affordable subset in ID order. Ineligible structures are reported separately. */
export function quoteBuildingUpgrades(
  player: Player,
  state: ProgressionState,
  inventory: Inventory,
  buildings: readonly Building[],
  owners: Uint8Array,
  ids: readonly number[],
): { upgrades: BuildingUpgrade[]; cost: Cost; reason: string | null; skipped: number; eligibleCount: number } {
  const upgrades: BuildingUpgrade[] = [], items: Inventory = {};
  const cost: Cost = { gold: 0, items };
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  let eligibleCount = 0;
  const result = (reason: string | null) => ({ upgrades, cost, reason, skipped: unique.length - eligibleCount, eligibleCount });
  if (!unique.length) return result("Select buildings to upgrade");
  const byId = new Map(buildings.map(b => [b.id, b]));
  const counts = new Map<Building["type"], number>();
  for (const b of buildings) if (b.playerId === player.id)
    counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  let unavailable = "No researched building upgrade available";
  for (const id of unique) {
    const building = byId.get(id);
    if (!building || building.playerId !== player.id || owners[building.tile] !== player.id)
      return result("Select buildings on your own territory");
    const current = building.age ?? "StoneAge";
    if (AUTOMATIC_TIER_BUILDINGS.includes(building.type)) {
      unavailable = "These buildings upgrade automatically with research";
      continue;
    }
    const maximum = building.maxHealth ?? buildingIntegrity(building.type, current);
    if (building.remainingTicks || (building.health ?? maximum) < maximum) {
      unavailable = "Complete construction and repair damage before upgrading";
      continue;
    }
    const age = nextBuildingAge(building.type, current, state.age, state.completed);
    if (!age) {
      const next = AGES[AGES.indexOf(current) + 1];
      const technology = next && buildingTechnology(building.type, next);
      unavailable = next && AGES.indexOf(next) <= AGES.indexOf(state.age) && technology
        ? "Research the next building tier first" : "Maximum available building tier reached";
      continue;
    }
    const count = counts.get(building.type) ?? 0;
    const price = buildingUpgradeCost(building.type, age, count);
    eligibleCount++;
    const proposedItems = { ...items };
    for (const [item, n] of Object.entries(price.items ?? {})) proposedItems[item] = (proposedItems[item] ?? 0) + n;
    const rejection = costRejection(player, inventory, { gold: cost.gold! + (price.gold ?? 0), items: proposedItems });
    if (rejection) { unavailable = rejection; continue; }
    upgrades.push({ building, age, cost: price, ticks: Math.max(1, Math.round(buildingTicks(building.type, count) / 2)) });
    cost.gold! += price.gold ?? 0;
    for (const [item, n] of Object.entries(price.items ?? {})) items[item] = (items[item] ?? 0) + n;
  }
  return result(upgrades.length ? null : unavailable);
}
