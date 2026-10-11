import type { Technology } from "../domain/Definitions";
import type { FormationRecipe, RecipeVariant } from "../domain/Manpower";
import data from "./formation-recipes.json";
export const FORMATION_RECIPES: Readonly<Record<string, FormationRecipe>> =
  data.recipes as Record<string, FormationRecipe>;
export const CAPACITY_TECHNOLOGIES: readonly Technology[] =
  data.technologies as Technology[];
export function recruitmentVariant(
  definitionId: string,
  research: readonly string[],
): RecipeVariant {
  const recipe = FORMATION_RECIPES[definitionId];
  return recipe?.technologyId && research.includes(recipe.technologyId)
    ? "enlarged"
    : "base";
}
