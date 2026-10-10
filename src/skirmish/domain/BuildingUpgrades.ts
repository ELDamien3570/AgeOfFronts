import type { Building, Player } from "../Protocol";
import { type Age, type Cost, type Inventory, type ProgressionState } from "./Definitions";

export interface BuildingUpgrade {
  building: Building;
  age: Age;
  cost: Cost;
  ticks: number;
}

/** Retired quote retained for old callers; never offers paid upgrades. */
export function quoteBuildingUpgrades(
  player: Player,
  state: ProgressionState,
  inventory: Inventory,
  buildings: readonly Building[],
  owners: Uint8Array,
  ids: readonly number[],
): { upgrades: BuildingUpgrade[]; cost: Cost; reason: string | null; skipped: number; eligibleCount: number } {
  return {upgrades: [] as BuildingUpgrade[], cost: {gold: 0} as Cost,
    reason: "Buildings upgrade automatically with research", skipped: ids.length, eligibleCount: 0};
}
