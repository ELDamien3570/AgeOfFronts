import { CONTENT_HASH } from "../../content/Catalog";
import { UNIT, UNITS } from "../../content/Units";
import { validateRankLaunchSpacing } from "../../domain/CavalryMelee";
import type { AttackProfile, UnitDefinition } from "../../domain/Definitions";
import type { FormationShape } from "../../domain/FormationGeometry";
import { FIXED, TICKS_PER_SECOND } from "../../Protocol";
import {
  APPROVED_RECIPE_IDS,
  EXPERIMENT_REVISION,
  experimentDefinition,
  experimentDefinitions,
  numericStats,
  parseExperiment,
  type ExperimentState,
} from "./BalanceExperiment";
import { BALANCE_SCENARIOS, type ScenarioControls } from "./BalanceScenarios";
import {
  BATTLE_BONUS_TAGS,
  battleDefinition,
  validateBattleSetup,
  type BattleEntry,
  type BattleTuning,
  type RecipeTunings,
  type WeaponTuning,
} from "./BattleLabModel";

export const BALANCE_STORAGE_KEY = "ageoffronts-balance-preview-v1";
export const BALANCE_FILE_LIMIT = 2_000_000;
export interface RecipeDraft {
  definitionId: string;
  name: string;
  baseContentHash: string;
  baseline: BattleTuning;
  tuning: BattleTuning;
}
export interface BalanceDraft {
  kind: "ageoffronts-balance-preview";
  schemaVersion: 1 | 2;
  previewOnly: true;
  contentHash: string;
  recipes: RecipeDraft[];
  scenario: {
    entries: BattleEntry[];
    separation: number;
    controls?: ScenarioControls;
    rankLaunchSpacing?: number;
    cavalryMode?: "ranks";
  };
  experiment?: ExperimentState;
}

/** Editable stats in the same human units as tuning, retained for review even
 * when a later game version changes the live defaults. */
export function definitionTuning(unit: UnitDefinition): BattleTuning {
  function weapon(p: AttackProfile, melee = false): WeaponTuning {
    return {
      damage: p.damage,
      rpm: p.rpm ?? (60 * TICKS_PER_SECOND) / p.reloadTicks,
      rangeTiles: p.range / FIXED,
      ...(!melee && p.perSoldier
        ? { reloadSeconds: (p.reloadMs ?? 0) / 1000 }
        : {}),
      ...(!melee
        ? {
            accuracyNear: p.accuracy?.near ?? 100,
            accuracyFar: p.accuracy?.far ?? 100,
          }
        : {}),
      bonuses: Object.fromEntries(
        BATTLE_BONUS_TAGS.map((tag) => [tag, p.bonuses[tag] ?? 0]),
      ),
    };
  }
  return {
    hp: unit.formationRecipe!.soldierHp,
    meleeArmour: unit.meleeArmour,
    rangedArmour: unit.rangedArmour,
    speedPercent: unit.speedPercent,
    ...(unit.charge ? { chargeMultiplier: unit.chargeMultiplier ?? 1 } : {}),
    ...(unit.charge?.bonusDurationTicks !== undefined
      ? {
          chargeBonusSeconds: unit.charge.bonusDurationTicks / TICKS_PER_SECOND,
        }
      : {}),
    ...(unit.meleeAttack ? { melee: weapon(unit.meleeAttack, true) } : {}),
    ...(unit.rangedAttack ? { ranged: weapon(unit.rangedAttack) } : {}),
    ...(!unit.meleeAttack && !unit.rangedAttack
      ? { attack: weapon(unit.attack) }
      : {}),
  };
}

export function recipeTunings(recipes: readonly RecipeDraft[]): RecipeTunings {
  return Object.fromEntries(
    recipes.map((recipe) => [recipe.definitionId, recipe.tuning]),
  );
}

export function editRecipe(
  recipes: readonly RecipeDraft[],
  id: string,
  tuning: BattleTuning,
): RecipeDraft[] {
  battleDefinition(id, tuning);
  const previous = recipes.find((recipe) => recipe.definitionId === id);
  const rest = recipes.filter((recipe) => recipe.definitionId !== id);
  if (!Object.keys(tuning).length) return rest;
  return [
    ...rest,
    {
      definitionId: id,
      name: UNIT.get(id)!.name,
      baseContentHash: previous?.baseContentHash ?? CONTENT_HASH,
      baseline: structuredClone(
        previous?.baseline ?? definitionTuning(battleDefinition(id)),
      ),
      tuning: structuredClone(tuning),
    },
  ];
}

export function createBalanceDraft(
  entries: readonly BattleEntry[],
  separation: number,
  recipes: readonly RecipeDraft[],
  experiment?: ExperimentState,
  controls?: ScenarioControls,
  rankLaunchSpacing = 0.25,
  cavalryMode: "assault" | "ranks" = "assault",
): BalanceDraft {
  validateRankLaunchSpacing(rankLaunchSpacing);
  if (cavalryMode !== "assault" && cavalryMode !== "ranks")
    throw Error("Unknown cavalry attack pattern");
  validateBattleSetup(
    entries,
    separation,
    recipeTunings(recipes),
    experiment ? experimentDefinitions(experiment) : undefined,
  );
  if (entries.some((entry) => entry.tuning))
    throw Error(
      "Balance drafts require shared recipe stats, not roster overrides",
    );
  return structuredClone({
    kind: "ageoffronts-balance-preview",
    schemaVersion: 2,
    previewOnly: true,
    contentHash: CONTENT_HASH,
    recipes: [...recipes],
    scenario: {
      entries: [...entries],
      separation,
      ...(controls ? { controls } : {}),
      rankLaunchSpacing,
      ...(cavalryMode === "ranks" ? { cavalryMode } : {}),
    },
    ...(experiment
      ? { experiment: { ...experiment, profileRevision: EXPERIMENT_REVISION } }
      : {}),
  });
}

/** Resolved combat values accompany the compact experiment for human review. */
export function experimentRecipes(state: ExperimentState): RecipeDraft[] {
  let recipes: RecipeDraft[] = [];
  for (const unit of UNITS)
    if (APPROVED_RECIPE_IDS.includes(unit.id) || state.changes[unit.id])
      recipes = editRecipe(
        recipes,
        unit.id,
        definitionTuning(experimentDefinition(state, unit.id)),
      );
  return recipes;
}

function object(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`${label} must be an object`);
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row))
    if (!keys.includes(key)) throw Error(`Unknown ${label} field: ${key}`);
  return row;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.length || value.length > 256)
    throw Error(`Invalid ${label}`);
  return value;
}
function numeric(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw Error(`Invalid ${label}`);
  return value;
}
function tuning(value: unknown, id: string): BattleTuning {
  const row = object(
    value,
    [
      "hp",
      "meleeArmour",
      "rangedArmour",
      "speedPercent",
      "chargeMultiplier",
      "chargeBonusSeconds",
      "melee",
      "ranged",
      "attack",
    ],
    "tuning",
  );
  const result: BattleTuning = {};
  for (const key of [
    "hp",
    "meleeArmour",
    "rangedArmour",
    "speedPercent",
    "chargeMultiplier",
    "chargeBonusSeconds",
  ] as const)
    if (key in row) result[key] = numeric(row[key], key);
  for (const channel of ["melee", "ranged", "attack"] as const) {
    if (!(channel in row)) continue;
    const source = object(
      row[channel],
      [
        "damage",
        "rpm",
        "rangeTiles",
        "reloadSeconds",
        "accuracyNear",
        "accuracyFar",
        "bonuses",
      ],
      "weapon",
    );
    const patch: WeaponTuning = {};
    for (const key of [
      "damage",
      "rpm",
      "rangeTiles",
      "reloadSeconds",
      "accuracyNear",
      "accuracyFar",
    ] as const)
      if (key in source) patch[key] = numeric(source[key], key);
    if ("bonuses" in source) {
      const bonuses = object(source.bonuses, BATTLE_BONUS_TAGS, "bonus");
      patch.bonuses = Object.fromEntries(
        Object.entries(bonuses).map(([tag, n]) => [tag, numeric(n, tag)]),
      );
    }
    result[channel] = patch;
  }
  const unit = battleDefinition(id, result);
  if (result.attack && (unit.meleeAttack || unit.rangedAttack))
    throw Error("Use this recipe’s melee/ranged weapon channels");
  return result;
}

/** Strict, bounded and atomic: no live catalogue writes or partial imports. */
export function parseBalanceDraft(json: string): BalanceDraft {
  if (json.length > BALANCE_FILE_LIMIT)
    throw Error("Balance draft exceeds 2 MB");
  const root = object(
    JSON.parse(json),
    [
      "kind",
      "schemaVersion",
      "previewOnly",
      "contentHash",
      "recipes",
      "scenario",
      "experiment",
    ],
    "draft",
  );
  if (
    root.kind !== "ageoffronts-balance-preview" ||
    ![1, 2].includes(root.schemaVersion as number) ||
    root.previewOnly !== true
  )
    throw Error("Choose a Balance Preview export (schema version 1 or 2)");
  if (root.schemaVersion === 1 && root.experiment)
    throw Error("Experiments require schema version 2");
  const experiment =
    root.experiment === undefined
      ? undefined
      : parseExperiment(root.experiment);
  const definitions = experiment
    ? experimentDefinitions(experiment)
    : new Map<string, UnitDefinition>();
  if (!Array.isArray(root.recipes) || root.recipes.length > UNITS.length)
    throw Error("Invalid recipe draft list");
  const seen = new Set<string>();
  const recipes = root.recipes.map((value): RecipeDraft => {
    const row = object(
      value,
      ["definitionId", "name", "baseContentHash", "baseline", "tuning"],
      "recipe",
    );
    const id = text(row.definitionId, "recipe ID");
    if (!UNIT.get(id)?.formationRecipe || seen.has(id))
      throw Error(`Unknown or duplicate land recipe: ${id}`);
    seen.add(id);
    return {
      definitionId: id,
      name: text(row.name, "recipe name"),
      baseContentHash: text(row.baseContentHash, "baseline content hash"),
      baseline: tuning(row.baseline, id),
      tuning: tuning(row.tuning, id),
    };
  });
  const scenario = object(
    root.scenario,
    ["entries", "separation", "controls", "rankLaunchSpacing", "cavalryMode"],
    "scenario",
  );
  let controls: ScenarioControls | undefined;
  if (scenario.controls !== undefined) {
    const row = object(
      scenario.controls,
      ["id", "variant", "includeVehicles"],
      "scenario controls",
    );
    if (
      !BALANCE_SCENARIOS.some((preset) => preset.id === row.id) ||
      (row.variant !== "base" && row.variant !== "enlarged") ||
      typeof row.includeVehicles !== "boolean"
    )
      throw Error("Invalid scenario controls");
    controls = {
      id: row.id as string,
      variant: row.variant,
      includeVehicles: row.includeVehicles,
    };
  }
  if (!Array.isArray(scenario.entries) || scenario.entries.length > 48)
    throw Error("Invalid battle roster");
  const entries = scenario.entries.map((value): BattleEntry => {
    const row = object(
      value,
      [
        "side",
        "definitionId",
        "formations",
        "soldiers",
        "variant",
        "shape",
        "deployment",
      ],
      "roster",
    );
    if (row.side !== 1 && row.side !== 2) throw Error("Invalid side");
    if (row.variant !== "base" && row.variant !== "enlarged")
      throw Error("Invalid recipe size");
    const deployment =
      row.deployment === undefined
        ? undefined
        : object(row.deployment, ["depth", "lane"], "deployment");
    return {
      side: row.side,
      definitionId: text(row.definitionId, "recipe ID"),
      formations: numeric(row.formations, "formation count"),
      soldiers: numeric(row.soldiers, "soldier count"),
      variant: row.variant,
      shape: text(row.shape, "formation") as FormationShape,
      ...(deployment
        ? {
            deployment: {
              depth: numeric(deployment.depth, "deployment depth"),
              lane: numeric(deployment.lane, "deployment lane"),
            },
          }
        : {}),
    };
  });
  const separation = numeric(scenario.separation, "separation");
  const rankLaunchSpacing =
    scenario.rankLaunchSpacing === undefined
      ? 1
      : numeric(scenario.rankLaunchSpacing, "rank launch spacing");
  validateRankLaunchSpacing(rankLaunchSpacing);
  if (scenario.cavalryMode !== undefined && scenario.cavalryMode !== "ranks")
    throw Error("Unknown cavalry attack pattern");
  validateBattleSetup(entries, separation, recipeTunings(recipes), definitions);
  if (experiment)
    for (const recipe of recipes) {
      const unit = experimentDefinition(
        experiment,
        recipe.definitionId,
        experiment.profileRevision,
      );
      const expected = numericStats(unit),
        patched = numericStats(battleDefinition(unit.id, recipe.tuning, unit));
      if (
        Object.entries(patched).some(([key, value]) => value !== expected[key])
      )
        throw Error("Recipe values disagree with the shared experiment");
    }
  return {
    kind: "ageoffronts-balance-preview",
    schemaVersion: root.schemaVersion as 1 | 2,
    previewOnly: true,
    contentHash: text(root.contentHash, "content hash"),
    recipes,
    scenario: {
      entries,
      separation,
      ...(controls ? { controls } : {}),
      ...(scenario.rankLaunchSpacing === undefined
        ? {}
        : { rankLaunchSpacing }),
      ...(scenario.cavalryMode === "ranks" ? { cavalryMode: "ranks" } : {}),
    },
    ...(experiment ? { experiment } : {}),
  };
}
