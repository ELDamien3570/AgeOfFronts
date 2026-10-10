import { FIXED } from "../Protocol";
import { packageTechnology } from "../content/Technology";
import {
  AGES,
  type Inventory,
  type UnitDefinition,
  type VesselDefinition,
} from "./Definitions";
export type Research = readonly string[];
// Authored values replace tiers. Research is never compounded on an entity or
// copied on capture; effects resolve from the current owner's completed nodes.
export function unitEffects(
  unit: UnitDefinition,
  research: Research,
): UnitDefinition {
  // Equipment packages unlock the authored age-specific unit statistics.
  // No detached drill/radio/optics research survives in the packaged tree.
  return unit;
}
const improvedVessels = new WeakMap<
  VesselDefinition,
  Map<string, VesselDefinition>
>();
export function vesselEffects(
  vessel: VesselDefinition,
  research: Research,
): VesselDefinition {
  const missiles =
    vessel.age === "Modern" &&
    vessel.kind === "warship" &&
    research.includes(
      packageTechnology("Modern", "naval-missiles-air-defence"),
    );
  const modernFleet = research.includes(
    packageTechnology("Modern", "ship-improvements"),
  );
  const ownImprovement = research.includes(
    packageTechnology(
      vessel.age,
      vessel.age === "StoneAge" ? "coastal-navigation" : "ship-improvements",
    ),
  );
  const coastal =
    ownImprovement && vessel.age === "StoneAge" && vessel.kind !== "trade";
  const general = modernFleet || (ownImprovement && vessel.age !== "StoneAge");
  if (!missiles && !coastal && !general) return vessel;
  const key = `${Number(missiles)}${Number(coastal)}${Number(general)}`;
  let cache = improvedVessels.get(vessel);
  if (!cache) {
    cache = new Map();
    improvedVessels.set(vessel, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;
  const improved = {
    ...vessel,
    speed: Math.round(vessel.speed * (coastal ? 1.1 : 1)),
    health: Math.round(vessel.health * (general ? 1.1 : 1)),
    capacity: vessel.capacity
      ? Math.ceil(vessel.capacity * (coastal ? 1.25 : general ? 1.1 : 1))
      : 0,
    attack: vessel.attack
      ? {
          ...vessel.attack,
          damage: Math.round(vessel.attack.damage * (missiles ? 1.15 : 1)),
          range: vessel.attack.range + (missiles ? FIXED : 0),
          reloadTicks: Math.max(
            1,
            Math.round(
              vessel.attack.reloadTicks * (coastal ? 0.9 : general ? 0.95 : 1),
            ),
          ),
        }
      : undefined,
  };
  cache.set(key, improved);
  return improved;
}
export function logisticsTier(research: Research): number {
  let tier = 0;
  for (const [i, age] of AGES.entries())
    if (research.includes(packageTechnology(age, "roads"))) tier = i;
  return tier;
}
export function roadsUnlocked(research: Research): boolean {
  return AGES.some((age) => research.includes(packageTechnology(age, "roads")));
}
export function landTraderTier(research: Research): number {
  let tier = 0;
  for (const [i, age] of AGES.entries())
    if (research.includes(packageTechnology(age, "land-traders"))) tier = i;
  return tier;
}
export function portCargoPercent(research: Research): number {
  let percent = 100;
  for (const [i, age] of AGES.entries())
    if (research.includes(packageTechnology(age, "ports")))
      percent = 100 + i * 5;
  return percent;
}
export function cargoHandlingPercent(research: Research): number {
  return research.includes(packageTechnology("StoneAge", "land-traders"))
    ? 125
    : 100;
}
export function breedingPerSecond(research: Research): number {
  let tier = -1;
  for (const [i, age] of AGES.entries())
    if (research.includes(packageTechnology(age, "land-traders"))) tier = i;
  return tier < 0 ? 0 : Math.min(6, tier + 1);
}
export function throughputPercent(research: Research): number {
  let percent = 100;
  for (const [i, age] of AGES.entries())
    if (research.includes(packageTechnology(age, "factories-mines")))
      percent = 110 + i * 10;
  return percent;
}
export function scaledInputs(inputs: Inventory, tier = 1): Inventory {
  return Object.fromEntries(
    Object.entries(inputs).map(([id, n]) => [id, n * tier]),
  );
}
