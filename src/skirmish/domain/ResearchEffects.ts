import { FIXED } from "../Protocol";
import { technologyAt } from "../content/Technology";
import {
  AGES,
  type Inventory,
  type UnitDefinition,
  type VesselDefinition,
} from "./Definitions";
export type Research = readonly string[];
const has = (
  research: Research,
  age: (typeof AGES)[number],
  tree: "naval" | "warfare" | "economic",
  slot: number,
) => research.includes(technologyAt(age, tree, slot).id);
// Authored values replace tiers. Research is never compounded on an entity or
// copied on capture; effects resolve from the current owner's completed nodes.
export function unitEffects(
  unit: UnitDefinition,
  research: Research,
): UnitDefinition {
  const drill = unit.age !== "Modern" && has(research, unit.age, "warfare", 4);
  const infantry =
    unit.tags.includes("infantry") || unit.troopClass === "rangedInfantry";
  const radio =
    infantry &&
    research.includes("russian-infantry-radios") &&
    AGES.indexOf(unit.age) >= 6;
  const optics =
    infantry &&
    research.includes("russian-infantry-optics") &&
    unit.age === "Modern";
  const tank =
    unit.tags.includes("vehicle") && unit.troopClass === "rangedCavalry";
  const armour = tank && research.includes("russian-tank-armour");
  const fireControl = tank && research.includes("russian-tank-fire-control");
  if (!drill && !radio && !optics && !armour && !fireControl) return unit;
  const attackPercent =
    100 +
    (drill ? 10 : 0) +
    (radio ? 10 : 0) +
    (optics ? 10 : 0) +
    (fireControl ? 10 : 0);
  return {
    ...unit,
    healthPercent: Math.round((unit.healthPercent ?? 100) * (armour ? 1.2 : 1)),
    meleeArmour:
      unit.armourKind === "points"
        ? unit.meleeArmour +
          (drill ? Math.max(3, Math.round(unit.attack.damage * 0.025)) : 0)
        : Math.min(6500, unit.meleeArmour + 300),
    rangedArmour:
      unit.armourKind === "points"
        ? unit.rangedArmour +
          (drill ? Math.max(3, Math.round(unit.attack.damage * 0.025)) : 0)
        : Math.min(7000, unit.rangedArmour + 300),
    attack: {
      ...unit.attack,
      damage: Math.round((unit.attack.damage * attackPercent) / 100),
      reloadTicks: Math.max(
        1,
        Math.round(unit.attack.reloadTicks * (drill ? 0.95 : 1)),
      ),
    },
  };
}
const improvedVessels = new WeakMap<VesselDefinition, VesselDefinition>();
export function vesselEffects(
  vessel: VesselDefinition,
  research: Research,
): VesselDefinition {
  const missiles =
    vessel.age === "Modern" &&
    vessel.kind === "warship" &&
    research.includes("russian-naval-missiles");
  const sailing =
    vessel.age !== "Modern" && has(research, vessel.age, "naval", 4);
  if (!missiles && !sailing) return vessel;
  const cached = improvedVessels.get(vessel);
  if (cached) return cached;
  const improved = {
    ...vessel,
    speed: Math.round(vessel.speed * (sailing ? 1.1 : 1)),
    capacity: vessel.capacity
      ? Math.ceil(vessel.capacity * (sailing ? 1.25 : 1))
      : 0,
    attack: vessel.attack
      ? {
          ...vessel.attack,
          damage: Math.round(vessel.attack.damage * (missiles ? 1.15 : 1)),
          range: vessel.attack.range + (missiles ? FIXED : 0),
          reloadTicks: Math.max(
            1,
            Math.round(vessel.attack.reloadTicks * (sailing ? 0.9 : 1)),
          ),
        }
      : undefined,
  };
  improvedVessels.set(vessel, improved);
  return improved;
}
export function logisticsTier(research: Research): number {
  let tier = 0;
  for (const [i, age] of AGES.entries())
    if (has(research, age, "economic", i === 0 ? 2 : 3)) tier = i;
  return tier;
}
export function cargoHandlingPercent(research: Research): number {
  return research.includes(technologyAt("StoneAge", "economic", 4).id)
    ? 125
    : 100;
}
export function breedingPerSecond(research: Research): number {
  if (has(research, "EarlyModern", "economic", 4)) return 6;
  if (has(research, "Napoleonic", "economic", 4)) return 5;
  if (has(research, "EarlyMedieval", "economic", 3)) return 4;
  if (has(research, "ClassicalAge", "economic", 2)) return 2;
  return 0;
}
export function throughputPercent(research: Research): number {
  let percent = 100;
  for (const [i, age] of AGES.entries())
    if (has(research, age, "economic", 4)) percent = 110 + i * 10;
  return percent;
}
export function scaledInputs(inputs: Inventory, tier = 1): Inventory {
  return Object.fromEntries(
    Object.entries(inputs).map(([id, n]) => [id, n * tier]),
  );
}
