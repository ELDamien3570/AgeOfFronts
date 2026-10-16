import { UNIT, UNITS } from "../../content/Units";
import {
  AGES,
  AGE_NAMES,
  type Age,
  type UnitDefinition,
} from "../../domain/Definitions";
import { formationDoctrine } from "../../domain/FormationGeometry";
import type { RecipeVariant } from "../../domain/Manpower";
import { scaledRecipeCost } from "../../domain/Manpower";
import { validateBattleSetup, type BattleEntry } from "./BattleLabModel";

export interface BalanceScenario {
  id: string;
  name: string;
  ages: readonly Age[];
}
export interface ScenarioControls {
  id: string;
  variant: RecipeVariant;
  includeVehicles: boolean;
}
export const BALANCE_SCENARIOS: readonly BalanceScenario[] = [
  ...AGES.map((age, i) => ({
    id: `contemporary-${age}`,
    name: `${AGE_NAMES[i]} · contemporary armies`,
    ages: [age],
  })),
  ...(
    [
      ["BronzeAge", "ClassicalAge"],
      ["ClassicalAge", "EarlyMedieval"],
      ["EarlyMedieval", "LateMedieval"],
      ["LateMedieval", "Napoleonic"],
    ] as const
  ).map((ages) => ({
    id: `mixed-${ages.join("-")}`,
    name: `${AGE_NAMES[AGES.indexOf(ages[0])]} + ${AGE_NAMES[AGES.indexOf(ages[1])]} · mixed armies`,
    ages,
  })),
];
function positionGroup(
  unit: UnitDefinition,
): "front" | "ranged" | "flank" | "support" {
  if (
    ["lightCavalry", "heavyCavalry", "rangedCavalry"].includes(
      unit.troopClass ?? "",
    )
  )
    return "flank";
  if (["frontline", "antiCavalry"].includes(unit.troopClass ?? ""))
    return "front";
  if (["artillery", "siege", "launcher", "anti-air"].includes(unit.role))
    return "support";
  return unit.formationRecipe?.model === "hull" ? "front" : "ranged";
}
export function makeBalanceScenario(
  id: string,
  variant: RecipeVariant = "base",
  includeVehicles = false,
  definitions: ReadonlyMap<string, UnitDefinition> = new Map(),
): { entries: BattleEntry[]; separation: number; description: string } {
  const scenario = BALANCE_SCENARIOS.find((value) => value.id === id);
  if (!scenario) throw Error("Unknown balance scenario");
  const units = UNITS.map((unit) => definitions.get(unit.id) ?? unit).filter(
    (unit) =>
      scenario.ages.includes(unit.age) &&
      (includeVehicles || unit.formationRecipe?.model === "soldiers"),
  );
  if (!units.length) throw Error("No units available for this scenario");
  const groups = Object.fromEntries(
    ["front", "ranged", "flank", "support"].map((group) => [
      group,
      units.filter((unit) => positionGroup(unit) === group),
    ]),
  );
  const frontWidth = Math.max(0, (groups.front.length - 1) * 2.5);
  const army = units.map((unit): Omit<BattleEntry, "side"> => {
    const group = positionGroup(unit),
      index = groups[group].indexOf(unit);
    const lane =
      group === "flank"
        ? (index % 2 ? 1 : -1) * (frontWidth + 5 + Math.floor(index / 2) * 5)
        : (index - (groups[group].length - 1) / 2) * 5;
    const depth = group === "ranged" ? 5 : group === "support" ? 12 : 0;
    const recipe = unit.formationRecipe!;
    return {
      definitionId: unit.id,
      formations: 1,
      soldiers: variant === "base" ? recipe.capacity : recipe.enlargedCapacity,
      variant,
      shape: formationDoctrine(unit.id).defaultShape,
      deployment: { depth, lane },
    };
  });
  const entries = ([1, 2] as const).flatMap((side) =>
    army.map((entry) => ({ ...structuredClone(entry), side })),
  );
  const separation = 12;
  validateBattleSetup(entries, separation, {}, definitions);
  return {
    entries,
    separation,
    description: `${scenario.name}. ${army.length} formations per side · ${army.reduce((n, entry) => n + entry.soldiers, 0)} soldiers/vehicles per side. Infantry forward, ranged behind, cavalry on flanks${includeVehicles ? ", artillery in support" : ""}.`,
  };
}
export function scenarioArmyCost(
  entries: readonly BattleEntry[],
  definitions: ReadonlyMap<string, UnitDefinition>,
): number {
  return entries
    .filter((entry) => entry.side === 1)
    .reduce(
      (gold, entry) =>
        gold +
        (scaledRecipeCost(
          definitions.get(entry.definitionId) ?? UNIT.get(entry.definitionId)!,
          entry.variant,
        ).gold ?? 0) *
          entry.formations,
      0,
    );
}
