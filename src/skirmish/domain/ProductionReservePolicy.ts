import type { Building } from "../Protocol";
import type { ProductionRecipe } from "./Definitions";

export function equipmentReserveKind(
  recipe: ProductionRecipe,
): "troop" | "siege" | "vehicle" | null {
  const item = Object.keys(recipe.outputs)[0];
  return !item.startsWith("equipment:")
    ? null
    : item.endsWith("-vehicle")
      ? "vehicle"
      : item.endsWith("-siege")
        ? "siege"
        : "troop";
}

/** The allocator and infrastructure planner share the same ready-stock goals.
 * Callers choose which completed or already-funded producers to count. */
export function productionReserveTargets(
  buildings: readonly Pick<Building, "type">[],
  squadCount: number,
) {
  return {
    troop: Math.min(
      600,
      Math.max(
        100,
        buildings.filter((b) =>
          ["blacksmith", "armory", "arms-factory"].includes(b.type),
        ).length * 3,
        Math.ceil(squadCount / 3),
      ),
    ),
    vehicle: Math.min(
      24,
      Math.max(
        2,
        buildings.filter((b) => b.type === "depot").length * 2,
        Math.ceil(squadCount / 12),
      ),
    ),
    siege: Math.min(
      16,
      Math.max(
        2,
        buildings.filter((b) => b.type === "siege-workshop").length * 2,
        Math.ceil(squadCount / 16),
      ),
    ),
  };
}
