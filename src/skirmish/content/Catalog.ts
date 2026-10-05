import { AGE_SQUAD_CAPS, TRIBE_PROMOTION_PERCENT, TRIBE_SQUAD_CAP, TRIBE_SQUADS_PER_AGE, TRIBE_TRADER_CAP, TRIBE_TRADERS_PER_AGE } from "../FactionRules";
import { BUILDING_RULES } from "../Rules";
import { MAX_ARMOUR, PROMOTION_ATTACK, XP_THRESHOLDS } from "../domain/Combat";
import { RESOURCES } from "../domain/Definitions";
import { DEPOSIT_RULES } from "../domain/DepositGeneration";
import { RECRUITMENT_SECONDS } from "../domain/Recruitment";
import { PRODUCTION_RECIPES } from "../domain/Supply";
import { TERRITORY_ABSORPTION } from "../domain/TerritoryAbsorption";
import { AI_PERSONALITIES } from "./AiPersonalities";
import { COASTAL_TERRITORY_RULES } from "./CoastalTerritory";
import { ARMY_CAPS } from "./Armies";
import { GUN_NEST_ATTACK, TRENCH_COVER } from "./Defences";
import {
  RESERVE_GROWTH,
  STARTING_AGE_TROOPS,
  WATER_TRADE_PRICING,
  TRADE_RULES,
} from "./Economy";
import { STARTING_ECONOMY } from "./StartingEconomy";
import { FACTIONS } from "./Factions";
import {
  ADVANCES,
  STARTING_TECHNOLOGIES,
  TECHNOLOGIES,
  TECHNOLOGY,
  validateTechnologies,
} from "./Technology";
import { UNITS, VESSELS } from "./Units";

// A culture is resolved once before a match starts. Only the authored default
// culture is selectable; future substitutions must resolve to complete content
// and pass this same validation, rather than adding culture branches to combat.
export const DEFAULT_CULTURE = Object.freeze({
  id: "default",
  name: "Default",
  startingTechnologies: STARTING_TECHNOLOGIES,
  technologyIds: TECHNOLOGIES.map((t) => t.id),
  unitIds: UNITS.map((u) => u.id),
  vesselIds: VESSELS.map((v) => v.id),
  recipeIds: PRODUCTION_RECIPES.map((r) => r.id),
});
export const CULTURES = new Map([[DEFAULT_CULTURE.id, DEFAULT_CULTURE]]);

export function validateCatalog(): void {
  validateTechnologies();
  const ids = new Set<string>(),
    items = new Set<string>(RESOURCES);
  for (const r of PRODUCTION_RECIPES)
    for (const id of Object.keys(r.outputs)) items.add(id);
  for (const definition of [...UNITS, ...VESSELS, ...PRODUCTION_RECIPES]) {
    if (ids.has(definition.id))
      throw new Error(`Duplicate definition ${definition.id}`);
    ids.add(definition.id);
    if (!TECHNOLOGY.has(definition.technologyId))
      throw new Error(`Missing unlock ${definition.id}`);
    if ("building" in definition && !BUILDING_RULES[definition.building])
      throw new Error(`Missing producer ${definition.id}`);
    const inventory =
      "inputs" in definition
        ? definition.inputs
        : (definition.cost.items ?? {});
    for (const [item, quantity] of Object.entries(inventory))
      if (!items.has(item) || !Number.isSafeInteger(quantity) || quantity < 0)
        throw new Error(`Invalid material ${definition.id}:${item}`);
  }
  for (const id of DEFAULT_CULTURE.startingTechnologies)
    if (!TECHNOLOGY.has(id)) throw new Error(`Missing grant ${id}`);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function hash(value: unknown): string {
  let result = 2166136261;
  for (const char of canonical(value))
    result = Math.imul(result ^ char.charCodeAt(0), 16777619) >>> 0;
  return result.toString(16).padStart(8, "0");
}
validateCatalog();
// Compatibility identifier for snapshots/reviews, not a security checksum.
export const CONTENT_HASH = hash({
  culture: DEFAULT_CULTURE,
  technologies: TECHNOLOGIES,
  units: UNITS,
  vessels: VESSELS,
  recipes: PRODUCTION_RECIPES,
  buildings: BUILDING_RULES,
  advances: ADVANCES,
  promotions: {
    thresholds: XP_THRESHOLDS,
    attack: PROMOTION_ATTACK,
    maxArmour: MAX_ARMOUR,
  },
  combatRevision: 3,
  shoreTransportRevision: 1,
  navalAutonomyRevision: 3,
  aiCombatPolicyRevision: 1,
  armyCaps: ARMY_CAPS,
  defences: { gunNest: GUN_NEST_ATTACK, trench: TRENCH_COVER },
  factions: FACTIONS,
  aiPersonalities: AI_PERSONALITIES,
  squadCaps: AGE_SQUAD_CAPS,
  tribeCaps: { squads: TRIBE_SQUAD_CAP, squadsPerAge: TRIBE_SQUADS_PER_AGE, traders: TRIBE_TRADER_CAP, tradersPerAge: TRIBE_TRADERS_PER_AGE },
  territoryAbsorption: TERRITORY_ABSORPTION,
  coastalTerritory: COASTAL_TERRITORY_RULES,
  recruitment: RECRUITMENT_SECONDS,
  deposits: DEPOSIT_RULES,
  tribePromotion: { percent: TRIBE_PROMOTION_PERCENT, conquestInheritance: 1 },
  economy: {
    reserves: RESERVE_GROWTH,
    startingTroops: STARTING_AGE_TROOPS,
    startingEconomy: STARTING_ECONOMY,
    tribeDevelopmentRevision: 2,
    waterTrade: WATER_TRADE_PRICING,
    trade: TRADE_RULES,
    waterTradeDestinations: "foreign-only",
    militaryInfrastructureRevision: 1,
  },
});
