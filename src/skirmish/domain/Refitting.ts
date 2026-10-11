import { scaledRecipeCost, type RecipeVariant } from './Manpower';
import { AGES, type Cost, type UnitDefinition } from "./Definitions";

// Shared payment rule for player and AI refits. Neither caller may discount
// equipment or charge differently for the same authoritative command.
export function unitRefitCost(target: UnitDefinition, count = 1, variant:RecipeVariant='base'): Cost {
  const items = { ...scaledRecipeCost(target,variant).items };
  delete items.horses; // Existing mounts are retained during a refit.
  return {
    gold: Math.ceil((500 + AGES.indexOf(target.age) * 300) * (variant==='enlarged'?target.formationRecipe!.enlargedCapacity/target.formationRecipe!.capacity:1)) * count,
    items: Object.fromEntries(
      Object.entries(items).map(([id, n]) => [id, n * count]),
    ),
  };
}
