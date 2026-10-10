import { AGES, type Cost, type UnitDefinition } from "./Definitions";

// Shared payment rule for player and AI refits. Neither caller may discount
// equipment or charge differently for the same authoritative command.
export function unitRefitCost(target: UnitDefinition, count = 1): Cost {
  const items = { ...target.cost.items };
  delete items.horses; // Existing mounts are retained during a refit.
  return {
    gold: (500 + AGES.indexOf(target.age) * 300) * count,
    items: Object.fromEntries(
      Object.entries(items).map(([id, n]) => [id, n * count]),
    ),
  };
}
