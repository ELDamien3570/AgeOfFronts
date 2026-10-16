import { scaledRecipeCost, type RecipeVariant } from './Manpower';
import { AGES, type Cost, type UnitDefinition } from "./Definitions";

/** Owner decision OD-8 (05 issue 8 / rec 5, 20 N10): a refit costs at least
 * this share of the recruit-gold gap between the source and the target, so an
 * old hull plus a refit is no longer far cheaper than a new one. */
export const REFIT_FLOOR_PERCENT = 60;
/** Floor for one base-recipe squad or one hull, from the authored recruit gold. */
export function refitFloorGold(targetGold: number, sourceGold: number): number {
  return Math.ceil(Math.max(0, targetGold - sourceGold) * REFIT_FLOOR_PERCENT / 100);
}
/** Flat per-age refit price before the floor. */
export function refitBaseGold(targetAge: UnitDefinition["age"]): number {
  return 500 + AGES.indexOf(targetAge) * 300;
}

// Shared payment rule for player and AI refits. Neither caller may discount
// equipment or charge differently for the same authoritative command. The
// source is the squad's current definition; null prices without the floor
// (only for callers that read the equipment items alone).
export function unitRefitCost(
  target: UnitDefinition,
  source: UnitDefinition | null,
  count = 1,
  variant: RecipeVariant = 'base',
): Cost {
  const items = { ...scaledRecipeCost(target,variant).items };
  delete items.horses; // Existing mounts are retained during a refit.
  const ratio = variant === 'enlarged'
    ? target.formationRecipe!.enlargedCapacity / target.formationRecipe!.capacity : 1;
  const base = Math.max(
    refitBaseGold(target.age),
    source ? refitFloorGold(target.cost.gold ?? 0, source.cost.gold ?? 0) : 0,
  );
  return {
    gold: Math.ceil(base * ratio) * count,
    items: Object.fromEntries(
      Object.entries(items).map(([id, n]) => [id, n * count]),
    ),
  };
}
