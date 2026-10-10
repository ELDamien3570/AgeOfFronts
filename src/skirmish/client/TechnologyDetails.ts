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
import { FLIGHT_RULES, flightTicks } from "../content/FlightOperations";
import {
  AIRCRAFT_RULES,
  ATOMIC_ATTACK,
  BOMBER_ATTACK,
  DRONE_ATTACK,
  NAVAL_AIR_ATTACK,
  STRATEGIC_PAYLOADS,
  STRATEGIC_RULES,
} from "../content/ModernWeapons";
import { PRODUCTION_RECIPES } from "../content/Production";
import { RESOURCE_TECHNOLOGIES } from "../content/Resources";
import { UNITS, VESSELS } from "../content/Units";
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
  const { id, age } = technology;
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
    const seconds =
      unit.trainingSeconds ??
      (unit.tags.includes("vehicle")
        ? RECRUITMENT_SECONDS.vehicle
        : unit.tags.includes("siege")
          ? RECRUITMENT_SECONDS.siege
          : RECRUITMENT_SECONDS[unit.line]);
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
    // Transports are the hulls of squads afloat, described below, not recruits.
    if (vessel.kind === "transport") continue;
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
  const role = id.replace(`rus-${age.toLowerCase()}-`, "");
  if (role === "factories-mines") {
    const percent = throughputPercent([id]);
    lines.push(
      `Recipe production rate: ${percent}% of base · cycle time ÷ ${number(percent / 100)} (rounded up to 0.05s; replaces earlier tiers)`,
    );
  }
  if (role === "roads")
    lines.push(
      `Trade traffic builds ${AGE_NAMES[ageIndex]} roads. Road tier is independent of trader cargo capacity.`,
    );
  if (role === "roads" || role === "land-traders") {
    const capacity = LAND_TRADE_CAPACITIES[ageIndex];
    lines.push(
      `Land trade: ${capacity} goods base cargo · ${Math.floor(capacity * 1.25)} with Stone Age cargo handling at one factory`,
    );
    lines.push(
      `Horse breeding: ${breedingPerSecond([id])} horses/s per completed owned stable (replaces earlier tiers)`,
    );
    if (!ageIndex)
      lines.push(
        "Cargo handling: +25% for land and sea traders (rounded down)",
      );
  }
  if (role === "cities") {
    lines.push(
      `City: +${cityReserveIncome(age, [id])} reserves/s at this tier`,
    );
    if (!ageIndex)
      lines.push(
        "Cities are unlocked from the start for reserves and cargo drop-off.",
      );
    else
      lines.push(
        "Existing cities upgrade automatically: improved health, reserve generation and receiving capacity.",
      );
  }
  if (role === "ports")
    lines.push(
      `Existing ports upgrade automatically. Land and sea cargo per trip: +${ageIndex * 5}% (replaces earlier port bonuses). Receiving capacity, cargo stock and building health improve with the port tier.`,
    );
  if (role === "coastal-navigation" || role === "ship-improvements") {
    for (const vessel of VESSELS.filter(
      (v) => age === "Modern" || v.age === age,
    )) {
      const upgraded = vesselEffects(vessel, [id]);
      lines.push(
        `${vessel.kind === "transport" ? "Squads afloat" : vessel.name}: hull ${vessel.health} → ${upgraded.health} · ${number((vessel.speed * TICKS_PER_SECOND) / FIXED)} → ${number((upgraded.speed * TICKS_PER_SECOND) / FIXED)} tiles/s${vessel.capacity ? ` · cargo ${vessel.capacity} → ${upgraded.capacity}` : ""}${vessel.attack ? ` · ${number(vessel.attack.reloadTicks / TICKS_PER_SECOND)} → ${number(upgraded.attack!.reloadTicks / TICKS_PER_SECOND)}s reload` : ""}`,
      );
    }
  }
  const transport = VESSELS.find(
    (v) => v.age === age && v.kind === "transport" && v.technologyId === id,
  );
  if (transport)
    lines.push(
      `Squads cross water as ${transport.name}: ${transport.health} hull · ${number((transport.speed * TICKS_PER_SECOND) / FIXED)} tiles/s · sinks with all aboard`,
    );
  if (role === "naval-missiles-air-defence") {
    lines.push("Modern warships: +15% base attack and +1 tile range");
    lines.push(
      `Air defence: ${weapon(NAVAL_AIR_ATTACK)} · homing rockets against hostile aircraft; drones cannot be intercepted`,
    );
  }
  if (role === "fortifications" && ageIndex >= 6) {
    lines.push(`Gun nest: ${weapon(GUN_NEST_ATTACK)}`);
    lines.push(
      `Trench cover: ${TRENCH_COVER.slots} infantry squads per trench tile · ${TRENCH_COVER.reduction / 100}% damage reduction within ${TRENCH_COVER.radius / FIXED} tile`,
    );
    if (age === "Modern")
      lines.push(
        `Ground air defence: ${weapon(NAVAL_AIR_ATTACK)} · drones cannot be intercepted`,
      );
  }
  if (["airfields", "bombers", "mirvs-drones"].includes(role)) {
    const kind =
      role === "airfields"
        ? "fighter"
        : role === "bombers"
          ? "bomber"
          : "drone";
    const rule = FLIGHT_RULES[kind];
    lines.push(
      `${kind}: ${number(rule.gold)} gold · ${RECRUITMENT_SECONDS.aircraft}s recruitment · ${number(AIRCRAFT_RULES.health)} HP · ${number((rule.speed * TICKS_PER_SECOND) / FIXED)} tiles/s`,
    );
    lines.push(
      `Aircraft capacity: ${AIRCRAFT_RULES.airfieldCapacity} per launch site · ${AIRCRAFT_RULES.factionCapacity} per faction · ${flightTicks(kind, age) / TICKS_PER_SECOND}s flight time`,
    );
    lines.push(
      "Outbound travel and patrol use flight time; return flight is free. Targets beyond the remaining flight budget are rejected. Shift launches up to 5.",
    );
    if (kind === "fighter")
      lines.push(
        "I Dispatch: patrol and intercept hostile fighters and bombers. Fighters do not bomb ground targets.",
      );
    if (kind === "bomber")
      lines.push(`P Bombing Run: ${weapon(BOMBER_ATTACK)}`);
    if (kind === "drone")
      lines.push(
        `U Drone Strike: ${weapon(DRONE_ATTACK)} · single use · no interception`,
      );
  }
  if (role === "nuclear-weapons")
    lines.push(
      `O A-Bomb Run: ${weapon(ATOMIC_ATTACK)} · one atomic payload per bomber · blast damages friendly and hostile targets`,
    );
  if (role === "missile-infrastructure" || role === "mirvs-drones") {
    lines.push(
      `Launch: ${number(STRATEGIC_RULES.gold)} gold + 1 matching payload · ${STRATEGIC_RULES.reloadTicks / TICKS_PER_SECOND}s launcher cooldown`,
    );
    for (const [name, payload] of Object.entries(STRATEGIC_PAYLOADS)) {
      if ((name === "mirv") !== (role === "mirvs-drones")) continue;
      lines.push(
        `${name === "hydrogen" ? "Hydrogen bomb" : name.toUpperCase()}: ${payload.warheads ? `${payload.warheads} warheads × ${number(payload.damage / payload.warheads)}` : number(payload.damage)} attack · ${payload.blastRadius / FIXED}-tile blast radius${payload.warheads ? " per warhead" : ""}`,
      );
    }
  }
  if (!lines.includes(technology.description))
    lines.push(technology.description);
  return lines.length ? lines : [technology.description];
}
