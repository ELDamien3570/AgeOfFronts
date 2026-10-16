import { z } from "zod";
import { UNITS } from "../../src/skirmish/content/Units";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { FORMATION_RULES_VERSION } from "../../src/skirmish/domain/Manpower";
import { validateFormationDoctrineData } from "../FormationDoctrineSchema";

// Pure compilers for the authored formation content in skirmish/plans/.
// Each takes parsed plan JSON and returns the runtime content data; the CLI
// entry points (scripts/compile*.ts, scripts/compileContent.ts) do the I/O.

const positive = z.number().int().positive();
const recipe = z
  .object({
    model: z.enum(["soldiers", "hull"]),
    capacity: positive.max(144),
    enlargedCapacity: positive.max(144),
    soldierHp: positive.max(100000),
    reserveCost: positive,
    technologyId: z.string().optional(),
  })
  .strict();
const technology = z
  .object({
    id: z.string(),
    age: z.enum(AGES),
    name: z.string(),
    tree: z.literal("warfare"),
    slot: positive,
    prerequisites: z.array(z.string()).min(1),
    gold: positive,
    ticks: positive,
    capabilities: z.array(z.string()),
    description: z.string(),
    optional: z.literal(true),
  })
  .strict();
const recipesSchema = z
  .object({
    schemaVersion: z.literal(1),
    rulesVersion: z.literal(FORMATION_RULES_VERSION),
    recipes: z.record(z.string(), recipe),
    technologies: z.array(technology).length(8),
  })
  .strict();

/**
 * skirmish/plans/formation-recipes.json → src/skirmish/content/formation-recipes.json.
 * `recruitment` is the packaged Rus recruitment content: optional capacity
 * technologies must hang off its (non-optional) technologies.
 */
export function compileFormationRecipes(
  plan: unknown,
  recruitment: { technologies: readonly { id: string }[] },
) {
  const data = recipesSchema.parse(plan);
  const ids = new Set(UNITS.map((u) => u.id)),
    techIds = new Set(data.technologies.map((t) => t.id)),
    base = new Set(recruitment.technologies.map((t) => t.id));
  if (Object.keys(data.recipes).length !== ids.size || techIds.size !== 8)
    throw new Error("Formation catalog coverage mismatch");
  for (const [id, r] of Object.entries(data.recipes))
    if (
      !ids.has(id) ||
      r.enlargedCapacity < r.capacity ||
      Boolean(r.technologyId) !== r.enlargedCapacity > r.capacity ||
      (r.technologyId && !techIds.has(r.technologyId))
    )
      throw new Error(`Invalid formation recipe ${id}`);
  for (const t of data.technologies)
    if (base.has(t.id) || !t.prerequisites.every((id) => base.has(id)))
      throw new Error(`Invalid optional capacity technology ${t.id}`);
  return data;
}

const bounded = z.number().min(0).max(100000);
const rpm = z.number().int().min(1).max(1200);
const tag = z.enum([
  "infantry",
  "ranged",
  "mounted",
  "armoured",
  "vehicle",
  "siege",
  "structure",
  "wall",
  "ship",
  "aircraft",
]);
const weaponBase = z
  .object({ damageHp: bounded.positive(), rpm, bonuses: z.partialRecord(tag, bounded) })
  .strict();
const melee = weaponBase.extend({ ranks: z.number().int().min(1).max(8) }).strict();
const ranged = weaponBase
  .extend({
    shotsPerReload: z.number().int().min(1).max(1000),
    reloadMs: z.number().int().min(0).max(600000),
    rangeTiles: z.number().positive().max(1000).optional(),
    accuracy: z
      .object({ near: z.number().min(0).max(100), far: z.number().min(0).max(100) })
      .strict()
      .optional(),
  })
  .strict();
const weaponEntry = z
  .object({
    melee: melee.nullable(),
    ranged: ranged.nullable(),
    defence: z.object({ meleeHp: bounded, rangedHp: bounded }).strict(),
    chargeMultiplier: z.number().min(1).max(10),
    chargeRecoveryTicks: z.number().int().min(1).max(1200).optional(),
  })
  .strict()
  .refine((value) => value.melee || value.ranged, "Soldier requires at least one weapon");
const weaponsSchema = z
  .object({
    schemaVersion: z.literal(2),
    rulesVersion: z.literal(FORMATION_RULES_VERSION),
    weapons: z.record(z.string(), weaponEntry),
  })
  .strict();

/**
 * skirmish/plans/soldier-weapons.json → src/skirmish/content/soldier-weapons.json.
 * Every soldier-model recipe in the authored `recipesPlan` needs a profile;
 * hull weapons are kept separately.
 */
export function compileSoldierWeapons(plan: unknown, recipesPlan: any) {
  const data = weaponsSchema.parse(plan);
  const ids = Object.entries(recipesPlan.recipes)
    .filter(([, r]: [string, any]) => r.model === "soldiers")
    .map(([id]) => id);
  if (
    ids.length !== Object.keys(data.weapons).length ||
    ids.some((id) => !data.weapons[id])
  )
    throw new Error("Soldier weapon catalogue coverage mismatch");
  return data;
}

/**
 * skirmish/plans/formation-doctrines.json → src/skirmish/content/formation-doctrines.json.
 * Validation only: the doctrine data passes through unchanged.
 */
export function compileFormationDoctrines(plan: unknown, recipesPlan: any) {
  return validateFormationDoctrineData(plan, recipesPlan.recipes);
}
