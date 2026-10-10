import { BUILDING_RULES } from "../Rules";
import data from "./russian-recruitment.json";
import baseline from "./technologies.json";

export const RUSSIAN_RECRUITMENT = data;
export const RUSSIAN_AGES = [
  "StoneAge",
  "BronzeAge",
  "ClassicalAge",
  "EarlyMedieval",
  "LateMedieval",
  "Napoleonic",
  "EarlyModern",
  "Modern",
] as const;
// Explicit readiness registry: this catalogue deliberately contains no drone,
// railway, submarine, refinery or warehouse facility unlocks.
export const RUSSIAN_UPGRADES = {
  "russian-infantry-radios": "infantry-attack",
  "russian-infantry-optics": "infantry-attack",
  "russian-tank-armour": "tank-armour",
  "russian-tank-fire-control": "tank-attack",
  "russian-naval-missiles": "naval-attack",
  "russian-precision-manufacturing": "factory-throughput",
  "russian-bayonet-drill": "infantry-melee",
  "russian-volley-fire": "infantry-ranged",
  "russian-artillery-carriages": "artillery-speed",
  "russian-copper-sheathing": "warship-speed",
  "russian-merchant-holds": "cargo-capacity",
  "russian-machine-tools": "factory-throughput",
  "russian-supply-depots": "factory-throughput",
  "russian-container-shipping": "cargo-capacity",
  "russian-assembly-line-upgrades": "factory-throughput",
  "russian-transport-hulls": "transport-health",
  "russian-maritime-cargo-systems": "cargo-capacity",
} as const;
const foundations = new Set([
  "russian-networked-command",
  "russian-vehicle-electronics",
  "russian-modern-naval-systems",
  "russian-digital-economy",
  "russian-automated-factories",
  "russian-trade-route-management",
  "russian-modern-transport-fleet",
  "russian-missile-frigates",
  "russian-bomber-squadrons",
  "russian-fighter-squadrons",
  "russian-precision-missiles",
  "russian-mirv-systems",
]);
export function validateRussianRecruitment(): void {
  const nodes = new Map(data.technologies.map((t) => [t.id, t]));
  if (nodes.size !== data.technologies.length)
    throw new Error("Duplicate research IDs");
  const legacy = new Set(baseline.map((t) => t.id));
  const troopUnlocks = new Set(data.units.map((u) => u.technologyId));
  for (const t of data.technologies) {
    const buildingPrefix = `russian-building-${t.age.toLowerCase()}-`;
    const building =
      t.id.startsWith(buildingPrefix) &&
      t.id.slice(buildingPrefix.length) in BUILDING_RULES;
    const supported =
      legacy.has(t.id) ||
      troopUnlocks.has(t.id) ||
      building ||
      t.id.startsWith("russian-support-") ||
      t.id in RUSSIAN_UPGRADES ||
      foundations.has(t.id) || (data.schemaVersion === 2 && t.id.startsWith("rus-"));
    if (!supported)
      throw new Error(`Unimplemented recruitment prerequisite: ${t.id}`);
    if (
      !RUSSIAN_AGES.includes(t.age as (typeof RUSSIAN_AGES)[number]) ||
      !Number.isSafeInteger(t.gold) ||
      t.gold < 0 ||
      !Number.isSafeInteger(t.ticks) ||
      t.ticks < 0
    )
      throw new Error(`Invalid research terms: ${t.id}`);
    for (const parent of t.prerequisites)
      if (!nodes.has(parent))
        throw new Error(`Missing prerequisite: ${parent}`);
  }
  const ids = new Set<string>();
  for (const u of data.units) {
    if (
      ids.has(u.id) ||
      !nodes.has(u.technologyId) ||
      !Number.isSafeInteger(u.gold) ||
      u.gold <= 0 ||
      !Number.isSafeInteger(u.trainingSeconds) ||
      u.trainingSeconds <= 0
    )
      throw new Error(`Invalid recruitment definition: ${u.id}`);
    ids.add(u.id);
  }
}
validateRussianRecruitment();
