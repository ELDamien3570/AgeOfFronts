import {TICKS_PER_SECOND} from '../Protocol';
import type { Squad } from "../Protocol";
import type { Cost, RecruitmentJob, UnitDefinition } from "./Definitions";
export const HEALTH_SCALE = 1000;
export const FORMATION_RULES_VERSION = 12;
export type RecipeVariant = "base" | "enlarged";
export interface FormationRecipe {
  model: "soldiers" | "hull";
  capacity: number;
  enlargedCapacity: number;
  soldierHp: number;
  reserveCost: number;
  technologyId?: string;
}
export interface EnlargementJob {
  definitionId: string;
  targetCapacity: number;
  added: number;
  cost: Cost;
  remainingTicks: number;
  totalTicks: number;
}
export interface ManpowerState {
  model: "soldiers" | "hull";
  capacity: number;
  hp: number;
  wounds: number;
  hullHealth?: number;
  variant: RecipeVariant;
  revision: number;
  replenishRemainder: number;
  enlargement?: EnlargementJob | null;
}
export function recipeCapacity(
  unit: UnitDefinition,
  variant: RecipeVariant = "base",
): number {
  return variant === "enlarged"
    ? unit.formationRecipe!.enlargedCapacity
    : unit.formationRecipe!.capacity;
}
export function createManpower(
  unit: UnitDefinition,
  variant: RecipeVariant = "base",
): ManpowerState {
  const recipe = unit.formationRecipe!,
    hp = Math.round(recipe.soldierHp * HEALTH_SCALE);
  return {
    model: recipe.model,
    capacity: recipeCapacity(unit, variant),
    hp,
    wounds: 0,
    ...(recipe.model === "hull" ? { hullHealth: hp } : {}),
    variant,
    revision: 0,
    replenishRemainder: 0,
    enlargement: null,
  };
}
export function remainingHealth(s: Pick<Squad, "troops" | "manpower">): number {
  const m = s.manpower;
  return m
    ? m.model === "hull"
      ? m.hullHealth!
      : Math.max(0, s.troops * m.hp - m.wounds)
    : s.troops;
}
export function maximumHealth(s: Pick<Squad, "troops" | "manpower">): number {
  return s.manpower
    ? s.manpower.model === "hull"
      ? s.manpower.hp
      : s.manpower.capacity * s.manpower.hp
    : 1000;
}
export function strengthFraction(
  s: Pick<Squad, "troops" | "manpower">,
): number {
  return Math.max(0, Math.min(1, remainingHealth(s) / maximumHealth(s)));
}
export function readyFraction(s: Pick<Squad, "troops" | "manpower">): number {
  return s.manpower
    ? s.manpower.model === "hull"
      ? strengthFraction(s)
      : s.troops / s.manpower.capacity
    : s.troops / 1000;
}
/** Phase 2 keeps squad weapon profiles. Phase 3 replaces their normalized inputs. */
export function legacyWeaponStrength(
  s: Pick<Squad, "troops" | "manpower">,
): number {
  return s.manpower
    ? s.manpower.model === "hull"
      ? strengthFraction(s) * 1000
      : (s.troops / s.manpower.capacity) * 1000
    : s.troops;
}
export function damageManpower(
  s: Pick<Squad, "troops" | "manpower">,
  damage: number,
) {
  const m = s.manpower!,
    applied = Math.max(0, Math.min(remainingHealth(s), Math.floor(damage)));
  if (m.model === "hull") {
    const health = Math.max(0, m.hullHealth! - applied);
    return {
      troops: health > 0 ? s.troops : 0,
      manpower: { ...m, hullHealth: health },
      applied,
      losses: health > 0 ? 0 : s.troops,
    };
  }
  const accumulated = m.wounds + applied,
    losses = Math.min(s.troops, Math.floor(accumulated / m.hp)),
    troops = s.troops - losses;
  return {
    troops,
    manpower: {
      ...m,
      wounds: troops ? accumulated - losses * m.hp : 0,
      revision: m.revision + (losses ? 1 : 0),
    },
    applied,
    losses,
  };
}
export function reserveConversion(points: number): number {
  return Math.floor((points * 12) / 1000);
}
/** Hull actors retain an abstract paid crew; actor count is not crew size. */
export function manpowerCount(
  unit: UnitDefinition | undefined,
  model: ManpowerState["model"] | undefined,
  losses: number,
): number {
  return model === "hull"
    ? losses * (unit?.formationRecipe?.reserveCost ?? 12)
    : losses;
}
export function validateRecipeManpower(
  unit: UnitDefinition | undefined,
  value: unknown,
  troops: number,
): asserts value is ManpowerState {
  validateManpower(value, troops);
  const m = value,
    recipe = unit?.formationRecipe;
  if (
    !recipe ||
    m.model !== recipe.model ||
    m.capacity !== recipeCapacity(unit!, m.variant) ||
    m.hp !== Math.round(recipe.soldierHp * HEALTH_SCALE)
  )
    throw new Error("Squad manpower does not match its recipe");
  if (m.enlargement) {
    const terms = enlargementTerms(unit!);
    const j = m.enlargement;
    if (
      m.model !== "soldiers" ||
      m.variant !== "base" ||
      j.definitionId !== unit!.id ||
      j.targetCapacity !== recipe.enlargedCapacity ||
      j.totalTicks !== terms.ticks ||
      j.cost.reserves !== terms.cost.reserves ||
      Object.keys(j.cost.items ?? {}).length !==
        Object.keys(terms.cost.items ?? {}).length ||
      Object.entries(terms.cost.items ?? {}).some(
        ([id, n]) => j.cost.items?.[id] !== n,
      ) ||
      (j.cost.gold !== 0 && j.cost.gold !== terms.cost.gold)
    )
      throw new Error("Enlargement escrow does not match its recipe");
  }
}
export function validateRecruitmentRecipe(
  unit: UnitDefinition | undefined,
  job: RecruitmentJob,
): void {
  if (
    !unit ||
    !job.recipeVariant ||
    !["base", "enlarged"].includes(job.recipeVariant) ||
    job.capacity !== recipeCapacity(unit, job.recipeVariant)
  )
    throw new Error("Invalid paid recruitment recipe");
  const expected = scaledRecipeCost(unit, job.recipeVariant);
  if (
    job.cost.reserves !== expected.reserves ||
    (job.cost.gold !== 0 && job.cost.gold !== expected.gold) ||
    Object.keys(job.cost.items ?? {}).length !==
      Object.keys(expected.items ?? {}).length ||
    Object.entries(expected.items ?? {}).some(
      ([id, n]) => job.cost.items?.[id] !== n,
    )
  )
    throw new Error("Invalid paid recruitment escrow");
}
export function scaledRecipeCost(
  unit: UnitDefinition,
  variant: RecipeVariant,
): Cost {
  const r = unit.formationRecipe!,
    capacity = recipeCapacity(unit, variant),
    ratio = capacity / r.capacity;
  return {
    ...unit.cost,
    gold: Math.ceil((unit.cost.gold ?? 0) * ratio),
    reserves: r.model === "soldiers" ? capacity : r.reserveCost,
    items: Object.fromEntries(
      Object.entries(unit.cost.items ?? {}).map(([id, n]) => [
        id,
        id === "horses" ? capacity : Math.ceil(n * ratio),
      ]),
    ),
  };
}
export function enlargementTerms(unit: UnitDefinition) {
  const base = scaledRecipeCost(unit, "base"),
    larger = scaledRecipeCost(unit, "enlarged");
  return {
    added:
      unit.formationRecipe!.enlargedCapacity - unit.formationRecipe!.capacity,
    ticks: Math.max(
      TICKS_PER_SECOND,
      Math.ceil(
        (unit.trainingSeconds ?? 10) *
          TICKS_PER_SECOND *
          (unit.formationRecipe!.enlargedCapacity /
            unit.formationRecipe!.capacity -
            1),
      ),
    ),
    cost: {
      gold: (larger.gold ?? 0) - (base.gold ?? 0),
      reserves: (larger.reserves ?? 0) - (base.reserves ?? 0),
      items: Object.fromEntries(
        Object.entries(larger.items ?? {}).map(([id, n]) => [
          id,
          n - (base.items?.[id] ?? 0),
        ]),
      ),
    } satisfies Cost,
  };
}
export function validateManpower(
  value: unknown,
  troops?: number,
): asserts value is ManpowerState {
  const m = value as ManpowerState;
  if (
    !m ||
    !["soldiers", "hull"].includes(m.model) ||
    !["base", "enlarged"].includes(m.variant) ||
    !Number.isSafeInteger(m.capacity) ||
    m.capacity < 1 ||
    m.capacity > 144 ||
    !Number.isSafeInteger(m.hp) ||
    m.hp < 1000 ||
    m.hp > 100_000_000 ||
    !Number.isSafeInteger(m.wounds) ||
    m.wounds < 0 ||
    m.wounds >= m.hp ||
    !Number.isSafeInteger(m.revision) ||
    m.revision < 0 ||
    !Number.isSafeInteger(m.replenishRemainder) ||
    m.replenishRemainder < 0 ||
    m.replenishRemainder >= 1000 ||
    (m.model === "hull" &&
      (m.capacity !== 1 ||
        m.wounds !== 0 ||
        !Number.isSafeInteger(m.hullHealth) ||
        m.hullHealth! < 0 ||
        m.hullHealth! > m.hp ||
        (troops !== undefined && (troops === 0) !== (m.hullHealth === 0)))) ||
    (troops !== undefined &&
      (!Number.isSafeInteger(troops) ||
        troops < 0 ||
        troops > m.capacity ||
        (troops === 0 && m.wounds !== 0)))
  )
    throw new Error("Invalid squad manpower");
  if (m.enlargement) {
    const j = m.enlargement;
    if (
      !j.cost ||
      typeof j.definitionId !== "string" ||
      j.definitionId.length > 100 ||
      !Number.isSafeInteger(j.targetCapacity) ||
      j.targetCapacity <= m.capacity ||
      j.targetCapacity > 144 ||
      j.added !== j.targetCapacity - m.capacity ||
      !Number.isSafeInteger(j.remainingTicks) ||
      j.remainingTicks < 1 ||
      j.remainingTicks > j.totalTicks ||
      !Number.isSafeInteger(j.totalTicks) ||
      j.totalTicks > 100_000
    )
      throw new Error("Invalid enlargement job");
    for (const n of [
      j.cost?.gold ?? 0,
      j.cost?.reserves ?? 0,
      ...Object.values(j.cost?.items ?? {}),
    ])
      if (!Number.isSafeInteger(n) || n < 0)
        throw new Error("Invalid enlargement escrow");
  }
}
