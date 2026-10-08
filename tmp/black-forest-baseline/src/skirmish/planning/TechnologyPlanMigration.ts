import technologies from "../content/technologies.json";
import { AGES, AGE_NAMES } from "../domain/Definitions";
import {
  validatePlan,
  type PlannedAge,
  type TechnologyPlan,
} from "./TechnologyPlan";

export const legacyPlanAges = (): PlannedAge[] =>
  AGES.map((id, index) => ({ id, name: AGE_NAMES[index], period: "" }));

/** Old exports keep their original age meanings and edited fields. Migration
 * does not opt an existing civilization into the Russian eight-age proposal. */
export function readTechnologyPlan(value: unknown): TechnologyPlan {
  let result = structuredClone(value) as Record<string, unknown>;
  if (
    result &&
    result.schemaVersion === 1 &&
    Array.isArray(result.civilizations)
  ) {
    const baseline = new Map(technologies.map((n) => [n.id, n]));
    result = {
      ...result,
      schemaVersion: 2,
      civilizations: result.civilizations.map((civ) => {
        if (!civ || typeof civ !== "object" || !Array.isArray(civ.technologies))
          return civ;
        return {
          ...civ,
          ages: legacyPlanAges(),
          technologies: civ.technologies.map(
            (node: Record<string, unknown>) => {
              if (!node || typeof node !== "object") return node;
              const source = baseline.get(node.id as string);
              return {
                ...node,
                kind: "unlock",
                gold: source?.gold ?? null,
                researchSeconds: source ? Math.round(source.ticks / 20) : null,
              };
            },
          ),
        };
      }),
    };
  }
  const errors = validatePlan(result);
  if (errors.length) throw new Error(errors.slice(0, 10).join("\n"));
  return result as unknown as TechnologyPlan;
}
