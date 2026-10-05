import { researchUtility, usableNextAge, type ResearchOpportunity } from "./AiResearchUtility";
import { AI_DOCTRINES } from "../content/AiDoctrines";
import type { BuildingType, Command } from "../Protocol";
import {
  buildingCost,
  buildingIntegrity,
  buildingUpgradeCost,
  nextBuildingAge,
  buildingTechnology,
  buildingTicks,
} from "../content/Buildings";
import { cityReserveIncome } from "../content/Economy";
import { ADVANCES, TECHNOLOGIES } from "../content/Technology";
import { UNITS } from "../content/Units";
import type { AiPriority } from "./AiBudgetLedger";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import type { AiProductionDemand } from "./AiMilitaryDemand";
import type { AiPersonality } from "./AiPersonality";
import { AGES, type Cost, type ProgressionState } from "./Definitions";
import {
  advanceRejection,
  researchRejection,
  researchTerms,
} from "./Progression";
import { PRODUCTION_RECIPES } from "./Supply";
import { militaryPosture } from "./AiMilitaryPosture";

export interface AiEconomicIntent {
  id: string;
  playerId: number;
  generation: number;
  kind: "construct" | "upgrade" | "research" | "advance" | "recruit";
  command: Command;
  cost: Cost;
  priority: AiPriority;
  score: number;
  reason: string;
  earliestTick: number;
  expiresTick: number;
  prerequisites: string[];
}
export interface AiInvestment {
  type: BuildingType;
  tile: number;
  objective: number;
  reason: string;
}

// A bounded event-horizon policy. It scores relative utility, never treats
// forecast income/paid output as liquid purchasing credit.
export function economicCandidates(
  snapshot: AiEconomicSnapshot,
  state: ProgressionState,
  personality: AiPersonality,
  demand: AiProductionDemand,
  speed: 1 | 2 | 3,
  investments: readonly AiInvestment[],
  opportunity: ResearchOpportunity = { resources: [], usableCoast: false, seaThreat: 0, goods: 0, protectedItems: {} },
): AiEconomicIntent[] {
  const candidates: AiEconomicIntent[] = [];
  const emit = (
    kind: AiEconomicIntent["kind"],
    key: string,
    command: Command,
    cost: Cost,
    benefit: number,
    reason: string,
    delay = 0,
    prerequisites: string[] = [],
  ) => {
    if (candidates.length >= 24) return;
    // Development utility uses the same scale across ages. Normalize its gold
    // opportunity cost to the authored age-price scale, preserving Stone Age
    // rankings while avoiding permanently negative later advances. Reservation
    // and command payment still require the full authoritative gold price.
    const development = kind === "research" || kind === "advance" || kind === "construct" || kind === "upgrade";
    const agePrice = ADVANCES[Math.min(AGES.indexOf(snapshot.age), ADVANCES.length - 1)].gold;
    const opportunity =
      Math.floor(((cost.gold ?? 0) / 20) * (development ? ADVANCES[0].gold / agePrice : 1)) +
      Object.values(cost.items ?? {}).reduce((n, v) => n + v * 25, 0);
    candidates.push({
      id: `${snapshot.playerId}:${kind}:${key}`,
      playerId: snapshot.playerId,
      generation: snapshot.generation,
      kind,
      command,
      cost,
      priority:
        snapshot.threatTroops > snapshot.readyTroops / 2 && kind === "recruit"
          ? "emergency"
          : kind === "research" || kind === "advance" ? "committed" : "growth",
      score: Math.floor((benefit * 2400) / Math.max(2400, delay+(kind==="construct" && ["blacksmith","armory","arms-factory"].includes((command as {buildingType?:string}).buildingType??"") ? Math.min(2400,demand.timeToOutput??0)/4:0))) - opportunity,
      reason,
      earliestTick: snapshot.tick,
      expiresTick: snapshot.tick + (kind === "research" || kind === "advance" ? 12000 : 2400),
      prerequisites,
    });
  };
  const coreMissing = Object.entries(demand.units).reduce(
    (n, [role, count]) =>
      n +
      Math.max(
        0,
        count! -
          snapshot.force.role(
            role as Parameters<typeof snapshot.force.role>[0],
          ),
      ),
    0,
  );
  const availableKits = Object.entries(snapshot.liquid.items ?? {})
    .filter(([id]) => id.startsWith("equipment:"))
    .reduce((n, [, count]) => n + count, 0);
  const reserveShortage = Math.max(
    0,
    Math.min(8, coreMissing) * 1000 - (snapshot.liquid.reserves ?? 0),
  );
  const materialShortage = Object.entries(demand.equipment).some(
    ([id, n]) =>
      (snapshot.liquid.items?.[id] ?? 0) + (snapshot.incoming[id] ?? 0) < n,
  );
  const counts = new Map<BuildingType, number>();
  for (const b of snapshot.buildings) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  let upgrades = 0;
  for (const b of snapshot.buildings) {
    if (upgrades >= 4) break;
    const age = nextBuildingAge(b.type, b.age ?? "StoneAge", state.age, state.completed);
    const maximum = b.maxHealth ?? buildingIntegrity(b.type, b.age ?? "StoneAge");
    if (!age || b.remainingTicks || (b.health ?? maximum) < maximum) continue;
    const cost = buildingUpgradeCost(b.type, age, counts.get(b.type) ?? 0);
    emit("upgrade", String(b.id), { type: "upgrade-building", playerId: snapshot.playerId, buildingIds: [b.id] },
      cost, b.type === "city" ? 500 + reserveShortage / 10 : 1000,
      "Modernize existing infrastructure without an extra site", Math.round(buildingTicks(b.type, counts.get(b.type) ?? 0) / 2));
    upgrades++;
  }
  for (const site of investments.slice(0, 8)) {
    const technology = buildingTechnology(site.type, snapshot.age);
    if (!technology) continue;
    const count = snapshot.buildings.filter((b) => b.type === site.type).length;
    const cost = buildingCost(site.type, snapshot.age, count),
      ticks = buildingTicks(site.type, count);
    let value = Math.floor(site.objective*(AI_DOCTRINES[personality.id].economy[site.type]??100)/100);
    if (site.type === "city")
      value +=
        reserveShortage > 0
          ? Math.floor(
              (Math.max(0, 2400 - ticks) * cityReserveIncome(snapshot.age)) /
                20,
            ) + Math.min(4000, reserveShortage)
          : 0;
    if (site.type === "factory") {
      const ore = [
        "ironOre",
        "carbon",
        "copper",
        "tin",
        "nitrate",
        "sulphur",
      ].reduce((n, id) => n + (snapshot.liquid.items?.[id] ?? 0), 0);
      value +=
        materialShortage && ore >= 20 ? 2800 + Math.min(2000, ore * 10) : 0;
    }
    if (
      ["barracks", "archery", "stables", "siege-workshop", "depot"].includes(
        site.type,
      )
    )
      value +=
        snapshot.headroom > 0 &&
        availableKits > 0 &&
        (snapshot.liquid.reserves ?? 0) >= 1000 &&
        snapshot.trainingTicks > 400
          ? 4500
          : 0;
    if (["blacksmith", "armory", "arms-factory"].includes(site.type)) {
      const recipes = PRODUCTION_RECIPES.filter(
        (r) =>
          r.building === site.type &&
          snapshot.research.includes(r.technologyId),
      );
      const readyInputs = recipes.some((r) =>
        Object.entries(r.inputs).every(
          ([id, n]) => (snapshot.liquid.items?.[id] ?? 0) >= n,
        ),
      );
      value += materialShortage && readyInputs ? 3500 : 0;
    }
    if (!snapshot.research.includes(technology)) {
      const research = TECHNOLOGIES.find((t) => t.id === technology)!;
      if (!researchRejection(state, Number.MAX_SAFE_INTEGER, technology, speed))
        emit(
          "research",
          technology,
          {
            type: "research",
            playerId: snapshot.playerId,
            technologyId: technology,
          },
          { gold: researchTerms(research, speed).gold },
          Math.floor(value * 0.8),
          `prerequisite:${site.reason}`,
          researchTerms(research, speed).ticks,
          [technology],
        );
      continue;
    }
    if (
      value <= 0 ||
      (snapshot.headroom === 0 &&
        !["city", "factory", "mine", "port", "oil-well", "oil-rig", "blacksmith", "armory", "arms-factory", "depot", "siege-workshop", "airstrip", "missile-silo", "mirv-launcher", "missile-defence"].includes(
          site.type,
        ))
    )
      continue;
    emit(
      "construct",
      `${site.type}:${site.tile}`,
      {
        type: "build",
        playerId: snapshot.playerId,
        buildingType: site.type,
        tile: site.tile,
      },
      cost,
      value,
      site.reason,
      ticks,
    );
  }
  for (const role of [
    "frontline",
    "ranged",
    "mounted",
    "siege",
    "artillery",
    "anti-air",
    "launcher",
  ] as const) {
    if (
      !snapshot.headroom ||
      snapshot.force.role(role) >= (demand.units[role] ?? 0)
    )
      continue;
    const unit = [...UNITS]
      .reverse()
      .find(
        (u) =>
          u.role === role &&
          snapshot.research.includes(u.technologyId) &&
          Object.entries(u.cost.items ?? {}).every(
            ([id, n]) => (snapshot.liquid.items?.[id] ?? 0) >= n,
          ) &&
          snapshot.buildings.some(
            (b) =>
              b.type === u.building &&
              !b.remainingTicks &&
              AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(u.age),
          ),
      );
    if (!unit) continue;
    const producer = snapshot.buildings
      .filter(
        (b) =>
          b.type === unit.building &&
          !b.remainingTicks &&
          AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(unit.age),
      )
      .sort(
        (a, b) =>
          snapshot.recruitment
            .filter((j) => j.buildingId === a.id)
            .reduce((n, j) => n + j.remainingTicks, 0) -
            snapshot.recruitment
              .filter((j) => j.buildingId === b.id)
              .reduce((n, j) => n + j.remainingTicks, 0) || a.id - b.id,
      )[0];
    emit(
      "recruit",
      unit.id,
      {
        type: "recruit",
        playerId: snapshot.playerId,
        buildingId: producer.id,
        definitionId: unit.id,
      },
      unit.cost,
      snapshot.threatTroops > 0 ? 10000 : 4000,
      `force-deficit:${role}`,
      400,
    );
  }
  for (const tree of personality.researchOrder) {
    const eligible = TECHNOLOGIES.filter(t => t.tree === tree && !researchRejection(state, Number.MAX_SAFE_INTEGER, t.id, speed))
      .map(technology => ({technology,utility:researchUtility(technology,snapshot,demand,opportunity)}))
      .sort((a,b) => b.utility.benefit-a.utility.benefit || a.technology.slot-b.technology.slot);
    const best = eligible.find(row=>row.utility.benefit>0);
    if (!best) continue;
    const {technology,utility} = best;
    const survival = snapshot.threatTroops > snapshot.readyTroops && technology.tree !== "warfare" ? 0 : utility.benefit;
    const bias = personality.id === "scholar" ? 1600 : 0;
    emit(
      "research",
      technology.id,
      {
        type: "research",
        playerId: snapshot.playerId,
        technologyId: technology.id,
      },
      { gold: researchTerms(technology, speed).gold },
      survival +
        bias +
        Math.max(0, 600 - personality.researchOrder.indexOf(tree) * 200),
      `research:${tree}:${utility.reason}`,
      researchTerms(technology, speed).ticks,
    );
  }
  if (
    !advanceRejection(state, Number.MAX_SAFE_INTEGER, speed) &&
    snapshot.threatTroops < snapshot.readyTroops &&
    (!materialShortage || availableKits >= 2) &&
    usableNextAge(snapshot, opportunity)
  ) {
    const terms = researchTerms(ADVANCES[AGES.indexOf(state.age)], speed);
    emit(
      "advance",
      snapshot.age,
      { type: "advance-age", playerId: snapshot.playerId },
      { gold: terms.gold },
      2500 + (personality.id === "scholar" ? 1500 : 0),
      "usable-age-transition",
      terms.ticks,
    );
  }
  // Saving is selected by the coordinator when the best useful step exceeds
  // current liquid stock; gold here never grants forecast purchasing credit.
  const ordered = candidates.filter(c => c.score > 0).sort(
    (a,b) => Number(b.priority === "emergency") - Number(a.priority === "emergency") ||
      Number(b.reason.includes("production-prerequisite:")) - Number(a.reason.includes("production-prerequisite:")) ||
      Number(b.kind === "advance") - Number(a.kind === "advance") ||
      (snapshot.readyTroops >= 4000 && snapshot.threatTroops <= snapshot.readyTroops / 2 ?
        Number(b.priority === "committed") - Number(a.priority === "committed") : 0) ||
      b.score-a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const choices = ordered.slice(0,4);
  // A reserve-starved recruit must not hide every gold-only development option.
  const development = ordered.find(c => c.kind === "research" || c.kind === "advance");
  if (development && !choices.includes(development)) choices[choices.length-1] = development;
  if (militaryPosture(snapshot,personality,speed).wealthy)
    for (const recruit of ordered.filter(c=>c.kind==="recruit").slice(0,3)) if (!choices.includes(recruit)) choices.push(recruit);
  return choices;
}
