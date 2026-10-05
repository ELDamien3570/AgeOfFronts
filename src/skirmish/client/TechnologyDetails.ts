import { FIXED, TICKS_PER_SECOND, type BuildingType } from "../Protocol";
import { BUILDING_RULES } from "../Rules";
import { ARMY_CAPS, ARMY_TECHNOLOGY } from "../content/Armies";
import { buildingTechnology } from "../content/Buildings";
import { GUN_NEST_ATTACK, TRENCH_COVER } from "../content/Defences";
import {
  cityReserveIncome,
  extractionYieldMultiplier,
  LAND_TRADE_CAPACITIES,
  tradeStockPerSecond,
} from "../content/Economy";
import { supplyItemName } from "../content/Equipment";
import {
  AIRCRAFT_RULES,
  BOMBER_ATTACK,
  STRATEGIC_PAYLOADS,
  STRATEGIC_RULES,
} from "../content/ModernWeapons";
import { PRODUCTION_RECIPES } from "../content/Production";
import { RESOURCE_TECHNOLOGIES } from "../content/Resources";
import { TRANSPORT_CAPACITIES, UNITS, VESSELS } from "../content/Units";
import { attackInterval } from "../domain/Combat";
import {
  AGE_NAMES,
  AGES,
  type AttackProfile,
  type Cost,
  type Inventory,
  type Technology,
} from "../domain/Definitions";
import { RECRUITMENT_SECONDS } from "../domain/Recruitment";
import {
  breedingPerSecond,
  throughputPercent,
  unitEffects,
  vesselEffects,
} from "../domain/ResearchEffects";

const number = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const items = (inventory: Readonly<Inventory>) =>
  Object.entries(inventory)
    .map(([id, amount]) => `${number(amount)} ${supplyItemName(id)}`)
    .join(" + ");
const cost = (value: Cost) =>
  [
    value.gold ? `${number(value.gold)} gold` : "",
    value.reserves ? `${number(value.reserves)} reserves` : "",
    items(value.items ?? {}),
  ]
    .filter(Boolean)
    .join(" + ");
function weapon(attack: AttackProfile, moving = false): string {
  if (!attack.targets.length) return "No direct attack";
  return [
    `${number(attack.damage)} ${attack.channel} attack`,
    `${number(attack.range / FIXED)}-tile range`,
    `${number(attack.reloadTicks / TICKS_PER_SECOND)}s reload`,
    moving && attack.movingReloadPercent !== 100
      ? `${number(attackInterval(attack, true) / TICKS_PER_SECOND)}s while moving`
      : "",
    attack.projectile?.blastRadius
      ? `${number(attack.projectile.blastRadius / FIXED)}-tile blast radius`
      : "",
    attack.penetration
      ? `${number(attack.penetration / 100)}% armour penetration`
      : "",
    ...Object.entries(attack.bonuses).map(
      ([tag, amount]) => `+${number(amount)} vs ${tag}`,
    ),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Catalogue values, without player upgrades. Keep numeric balance in its source definitions. */
export function technologyDetails(technology: Technology): string[] {
  const { id, age, tree, slot } = technology;
  const ageIndex = AGES.indexOf(age);
  const lines: string[] = [];
  const buildings = (Object.keys(BUILDING_RULES) as BuildingType[]).filter(
    (type) => buildingTechnology(type, age) === id,
  );
  if (buildings.length)
    lines.push(
      `Buildings: ${buildings.map((type) => BUILDING_RULES[type].name).join(", ")}`,
    );
  for (const unit of UNITS.filter((unit) => unit.technologyId === id)) {
    const seconds = unit.tags.includes("vehicle")
      ? RECRUITMENT_SECONDS.vehicle
      : unit.tags.includes("siege")
        ? RECRUITMENT_SECONDS.siege
        : RECRUITMENT_SECONDS[unit.line];
    lines.push(
      `${unit.name}: ${cost(unit.cost)} · ${seconds}s recruitment at ${BUILDING_RULES[unit.building].name}`,
    );
    lines.push(
      `${weapon(unit.attack, true)} · ${unit.speedPercent}% movement · ${unit.meleeArmour}/${unit.rangedArmour} melee/ranged armour${unit.armourKind === "points" ? " points" : " (1/100%)"}`,
    );
    if (unit.charge)
      lines.push(
        `Charge: ${number(unit.charge.damage)} attack · ${unit.charge.speedPercent}% movement · ${number(unit.charge.cooldownTicks / TICKS_PER_SECOND)}s cooldown`,
      );
  }
  for (const vessel of VESSELS.filter((vessel) => vessel.technologyId === id)) {
    if (vessel.kind === "trade") {
      lines.push(
        `Sea trade: ${vessel.capacity} goods base cargo per ship · automatic from ports`,
      );
      continue;
    }
    lines.push(
      `${vessel.name}: ${cost(vessel.cost)} · ${RECRUITMENT_SECONDS[vessel.kind]}s recruitment · ${number(vessel.health)} HP · ${number((vessel.speed * TICKS_PER_SECOND) / FIXED)} tiles/s${vessel.capacity ? ` · ${vessel.capacity} squads capacity` : ""}`,
    );
    if (vessel.attack) lines.push(weapon(vessel.attack));
  }
  for (const recipe of PRODUCTION_RECIPES.filter(
    (recipe) => recipe.technologyId === id,
  ))
    lines.push(
      `${recipe.name}: ${items(recipe.inputs)} → ${items(recipe.outputs)} · ${number(recipe.ticks / TICKS_PER_SECOND)}s base cycle at ${BUILDING_RULES[recipe.building].name}`,
    );
  const resources = Object.entries(RESOURCE_TECHNOLOGIES)
    .filter(([, unlock]) => unlock === id)
    .map(([resource]) => supplyItemName(resource));
  if (resources.length) lines.push(`Resources: ${resources.join(", ")}`);
  const army = ARMY_CAPS.find((rule) => rule.technologyId === id);
  if (army)
    lines.push(
      `Army capacity: ${army.capacity} squads${id === ARMY_TECHNOLOGY ? "" : " (requires Armies)"}`,
    );
  if (buildings.includes("city"))
    lines.push(`City: +${cityReserveIncome(age)} reserves/s at this tier`);
  if (buildings.includes("mine") || buildings.includes("oil-well"))
    lines.push(
      `Extraction: ${extractionYieldMultiplier(age)}× deposit yield per completed extractor of this tier`,
    );
  if (buildings.includes("factory") || buildings.includes("port"))
    lines.push(
      `Trade stock: ${tradeStockPerSecond(age)} goods/s per completed factory or port of this tier`,
    );
  if (
    tree === "economic" &&
    (slot === (ageIndex === 0 ? 2 : 3) || id === "stoneage-goods-handling")
  ) {
    const capacity = LAND_TRADE_CAPACITIES[ageIndex];
    lines.push(
      `Land trade: ${capacity} goods base cargo · ${Math.floor(capacity * 1.25)} with Goods Handling at one factory`,
    );
  }
  if (id === "stoneage-goods-handling")
    lines.push("Cargo: +25% for land and sea traders (rounded down)");
  if (tree === "economic" && slot === 4) {
    const percent = throughputPercent([id]);
    lines.push(
      `Recipe production rate: ${percent}% of base · cycle time ÷ ${number(percent / 100)} (rounded up to 0.05s; replaces earlier tiers)`,
    );
  }
  const breeding = breedingPerSecond([id]);
  if (breeding)
    lines.push(
      `Horse breeding: ${breeding} horses/s per completed owned stable (replaces earlier tiers)`,
    );
  if (id === "stoneage-horsemanship")
    lines.push("Horse breeding: 1 horse/4s per completed owned stable");
  if (tree === "warfare" && slot === 4) {
    const units = UNITS.filter((unit) => unit.age === age);
    lines.push(
      `All ${AGE_NAMES[ageIndex]} ground units: +10% base attack (rounded) · reload ×0.95 (rounded to 0.05s)`,
    );
    lines.push(
      `Melee/ranged armour bonus: ${units.map((unit) => `${unit.name} +${unitEffects(unit, [id]).meleeArmour - unit.meleeArmour} points`).join("; ")}`,
    );
  }
  if (tree === "naval" && slot === 4) {
    for (const vessel of VESSELS.filter(
      (vessel) => vessel.age === age && vessel.kind !== "trade",
    )) {
      const upgraded = vesselEffects(vessel, [id]);
      lines.push(
        `${vessel.kind === "transport" ? "Permanent transport" : "Warship"}: ${number((vessel.speed * TICKS_PER_SECOND) / FIXED)} → ${number((upgraded.speed * TICKS_PER_SECOND) / FIXED)} tiles/s${vessel.capacity ? ` · ${vessel.capacity} → ${upgraded.capacity} squads` : ""}${vessel.attack ? ` · ${number(vessel.attack.reloadTicks / TICKS_PER_SECOND)} → ${number(upgraded.attack!.reloadTicks / TICKS_PER_SECOND)}s reload` : ""}`,
      );
    }
  }
  const transport = VESSELS.find(
    (vessel) =>
      vessel.age === age &&
      vessel.kind === "transport" &&
      vessel.technologyId === id,
  );
  if (transport)
    lines.push(
      `Automatic shore transport: ${TRANSPORT_CAPACITIES[ageIndex]} squads · free embarkation`,
    );
  if (id === "modern-combined-arms") {
    lines.push(`Gun nest: ${weapon(GUN_NEST_ATTACK)}`);
    lines.push(
      `Trench cover: ${TRENCH_COVER.slots} infantry squads per trench tile · ${TRENCH_COVER.reduction / 100}% damage reduction within ${TRENCH_COVER.radius / FIXED} tile`,
    );
  }
  if (id === "modern-military-aviation") {
    lines.push(
      `Fighter or bomber: ${number(AIRCRAFT_RULES.gold)} gold · ${RECRUITMENT_SECONDS.aircraft}s recruitment · ${number(AIRCRAFT_RULES.health)} HP`,
    );
    lines.push(
      `Aircraft capacity: ${AIRCRAFT_RULES.airfieldCapacity} per airstrip · ${AIRCRAFT_RULES.factionCapacity} per faction · ${AIRCRAFT_RULES.fuelTicks / TICKS_PER_SECOND}s flight endurance`,
    );
    lines.push(
      `Bomb: ${number(BOMBER_ATTACK.damage)} attack · +${number(BOMBER_ATTACK.bonuses.structure!)} vs structures · ${BOMBER_ATTACK.penetration / 100}% armour penetration · ${BOMBER_ATTACK.projectile!.blastRadius / FIXED}-tile blast radius`,
    );
    lines.push(
      "Sortie: 1 ready squad; Shift launches up to 5. Runway is chosen automatically.",
    );
  }
  if (id === "modern-strategic-weapons") {
    lines.push(
      `Launch: ${number(STRATEGIC_RULES.gold)} gold + 1 matching payload · ${STRATEGIC_RULES.reloadTicks / TICKS_PER_SECOND}s launcher cooldown`,
    );
    for (const [name, payload] of Object.entries(STRATEGIC_PAYLOADS))
      lines.push(
        `${name === "hydrogen" ? "Hydrogen bomb" : name.toUpperCase()}: ${payload.warheads ? `${payload.warheads} warheads × ${number(payload.damage / payload.warheads)}` : number(payload.damage)} attack · ${payload.blastRadius / FIXED}-tile blast radius${payload.warheads ? " per warhead" : ""}`,
      );
  }
  return lines;
}
