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
  if (!has(research, unit.age, "warfare", 4)) return unit;
  return {
    ...unit,
    meleeArmour:
      unit.armourKind === "points"
        ? unit.meleeArmour + Math.max(3, Math.round(unit.attack.damage * 0.025))
        : Math.min(6500, unit.meleeArmour + 300),
    rangedArmour:
      unit.armourKind === "points"
        ? unit.rangedArmour +
          Math.max(3, Math.round(unit.attack.damage * 0.025))
        : Math.min(7000, unit.rangedArmour + 300),
    attack: {
      ...unit.attack,
      damage: Math.round(unit.attack.damage * 1.1),
      reloadTicks: Math.max(1, Math.round(unit.attack.reloadTicks * 0.95)),
    },
  };
}
export function vesselEffects(
  vessel: VesselDefinition,
  research: Research,
): VesselDefinition {
  if (!has(research, vessel.age, "naval", 4)) return vessel;
  return {
    ...vessel,
    speed: Math.round(vessel.speed * 1.1),
    capacity: vessel.capacity ? Math.ceil(vessel.capacity * 1.25) : 0,
    attack: vessel.attack
      ? {
          ...vessel.attack,
          reloadTicks: Math.max(1, Math.round(vessel.attack.reloadTicks * 0.9)),
        }
      : undefined,
  };
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
  if (has(research, "Modern", "economic", 4)) return 6;
  if (has(research, "EarlyModern", "economic", 4)) return 5;
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
