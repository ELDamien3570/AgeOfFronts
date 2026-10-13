import type { BuildingType } from "../Protocol";

// Temporary rollout gate while fortification pathing is being stabilized.
// Walls are automatic tower links. Set this to true to restore placement.
export const TOWER_PLACEMENT_ENABLED: boolean = false;

export function constructionAvailabilityRejection(type: BuildingType): string | null {
  return type === "tower" && !TOWER_PLACEMENT_ENABLED
    ? "Tower and wall placement is temporarily disabled"
    : null;
}
