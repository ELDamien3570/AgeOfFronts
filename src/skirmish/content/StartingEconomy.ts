import type { BuildingType } from "../Protocol";
import { buildingCost, buildingTechnology } from "./Buildings";
import { defaultUnit } from "./Units";
import { AGES, startingGameplayAge, type StartingAge, type Age, type Inventory } from "../domain/Definitions";

/** Opening banks are content, not income multipliers or research grants.
 * EarlyModern is the catalogue name for the attachment's sixth-age package. */
export const STARTING_ECONOMY: Readonly<Record<Age, { gold: number; reserves: number; items: Readonly<Inventory> }>> = {
  StoneAge: { gold: 4000, reserves: 6000, items: { stone: 60 } },
  BronzeAge: { gold: 8500, reserves: 8000, items: { stone: 60, bronze: 40, copper: 30, tin: 30, "equipment:bronzeage": 3 } },
  ClassicalAge: { gold: 13000, reserves: 10000, items: { stone: 80, iron: 50, bronze: 30, "equipment:classicalage": 3 } },
  EarlyMedieval: { gold: 17500, reserves: 12000, items: { stone: 80, iron: 60, horses: 20, "equipment:earlymedieval": 3 } },
  LateMedieval: { gold: 22000, reserves: 14000, items: { stone: 100, steel: 60, iron: 40, gunpowder: 30, horses: 20, "equipment:latemedieval": 3 } },
  EarlyModern: { gold: 27000, reserves: 16000, items: { steel: 80, carbon: 50, gunpowder: 40, iron: 40, "equipment:earlymodern": 3 } },
  Modern: { gold: 32000, reserves: 18000, items: { steel: 100, oil: 60, carbon: 50, gunpowder: 50, "equipment:modern": 3 } },
};

export function startingEconomy(start: StartingAge, tribe = false) {
  const age = startingGameplayAge(start);
  const bank = STARTING_ECONOMY[age], factor = AGES.indexOf(age) + 1;
  const types: BuildingType[] = tribe
    ? ["city", "port", "factory", "mine", "barracks"]
    : ["city", "city", "mine", "factory", "barracks", "barracks"];
  const smith = age === "Modern" ? "arms-factory" : age === "EarlyModern" ? "armory" : "blacksmith";
  if (buildingTechnology(smith, age)) types.push(smith);
  const counts = new Map<BuildingType, number>(tribe ? [["barracks", 1]] : []);
  const items = { ...bank.items }, required: Inventory = {};
  let gold = 0;
  for (const type of types) {
    const count = counts.get(type) ?? 0;
    const cost = buildingCost(type, age, count);
    counts.set(type, count + 1);
    gold += cost.gold ?? 0;
    for (const [item, n] of Object.entries(cost.items ?? {})) required[item] = (required[item] ?? 0) + n;
  }
  const unit = defaultUnit("infantry", age);
  gold += (unit.cost.gold ?? 0) * 2;
  for (const [item, n] of Object.entries(unit.cost.items ?? {})) required[item] = (required[item] ?? 0) + n * 2;
  for (const [item, n] of Object.entries(required)) items[item] = Math.max(items[item] ?? 0, n);
  // The supplied table predates V1's workshop/city prices. Fund the actual
  // requested opening instead of changing construction prices to fit it.
  return {
    gold: start === "PostModern" ? 1_000_000 : Math.max(tribe ? 3000 * factor : bank.gold, Math.ceil(gold / 500) * 500),
    reserves: tribe ? 2000 * factor : bank.reserves,
    items,
  };
}
