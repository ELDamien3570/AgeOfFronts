import { buildingTechnology } from "../content/Buildings";
import { PRODUCTION_RECIPES } from "../content/Production";
import { RESOURCE_TECHNOLOGIES } from "../content/Resources";
import { TECHNOLOGIES } from "../content/Technology";
import { UNITS, VESSELS } from "../content/Units";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import type { AiProductionDemand } from "./AiMilitaryDemand";
import { AiProductionDependencies } from "./AiProductionDependencies";
import { AGES, type Resource, type Technology } from "./Definitions";

export interface ResearchOpportunity {
  /** A faction has completed two trees in this age, or reached a later age. */
  progressionRace?: boolean;
  resources: readonly Resource[];
  usableCoast: boolean;
  seaThreat: number;
  goods: number;
  protectedItems: Readonly<Record<string, number>>;
}
/** Catalog work is finite (85 authored nodes); material paths retain the
 * existing 32-node dependency limit and count incoming/protected stock once. */
export function researchUtility(
  technology: Technology,
  snapshot: AiEconomicSnapshot,
  demand: AiProductionDemand,
  opportunity: ResearchOpportunity,
): { benefit: number; reason: string } {
  const research = [...snapshot.research, technology.id];
  const dependencies = new AiProductionDependencies(
    { ...snapshot, research },
    new Set(
      opportunity.resources.filter((r) =>
        research.includes(RESOURCE_TECHNOLOGIES[r]),
      ),
    ),
    opportunity.protectedItems,
  );
  let benefit = 0;
  const reasons: string[] = [];
  for (const unit of UNITS.filter((u) => u.technologyId === technology.id)) {
    const deficit = Math.max(
      0,
      (demand.units[unit.role] ?? 0) - snapshot.force.role(unit.role),
    );
    const attainable = Object.entries(unit.cost.items ?? {}).every(([id, n]) =>
      dependencies.available(id, n),
    );
    const production =
      snapshot.buildings.some(
        (b) =>
          b.type === unit.building && !b.remainingTicks && (b.health ?? 1) > 0,
      ) ||
      research.includes(buildingTechnology(unit.building, snapshot.age) ?? "");
    if (deficit && attainable && production && snapshot.headroom > 0) {
      benefit += Math.min(4, deficit) * 3200;
      reasons.push(`role:${unit.role}`);
    }
  }
  for (const recipe of PRODUCTION_RECIPES.filter(
    (r) => r.technologyId === technology.id,
  )) {
    const needed = Object.entries(recipe.outputs).some(
      ([id]) =>
        (demand.equipment[id] ?? demand.materials[id] ?? 0) >
        Math.max(
          0,
          (snapshot.liquid.items?.[id] ?? 0) -
            (opportunity.protectedItems[id] ?? 0),
        ) +
          (snapshot.incoming[id] ?? 0),
    );
    if (
      needed &&
      Object.entries(recipe.inputs).every(([id, n]) =>
        dependencies.available(id, n),
      )
    ) {
      benefit += 6500;
      reasons.push("production-bottleneck");
    }
  }
  if (
    opportunity.resources.some(
      (r) => RESOURCE_TECHNOLOGIES[r] === technology.id,
    )
  ) {
    benefit += 4500;
    reasons.push("owned-resource-access");
  }
  if (technology.tree === "naval" && opportunity.usableCoast) {
    const fleet = VESSELS.filter((v) => v.technologyId === technology.id);
    if (fleet.some((v) => v.kind === "warship") && opportunity.seaThreat > 0)
      benefit += 8000;
    if (fleet.some((v) => v.kind === "transport") && opportunity.goods >= 10)
      benefit += 5000;
    if (
      technology.capabilities.some((c) =>
        /navigation|cargo|handling|logistics/.test(c),
      ) &&
      (snapshot.ships.length || opportunity.goods >= 10)
    )
      benefit += 3500;
    if (buildingTechnology("port", snapshot.age) === technology.id)
      benefit += 4500;
    reasons.push("reachable-sea-use");
  }
  if (technology.tree === "economic") {
    if (
      buildingTechnology("city", snapshot.age) === technology.id &&
      snapshot.reserveIncome < 50
    ) {
      benefit += 5000;
      reasons.push("reserve-income");
    }
    if (
      buildingTechnology("factory", snapshot.age) === technology.id &&
      !snapshot.buildings.some((b) => b.type === "factory")
    ) {
      benefit += 4500;
      reasons.push("goods-production");
    }
    if (
      opportunity.goods >= 10 &&
      technology.capabilities.some((c) =>
        /goods|logistics|handling|roads/.test(c),
      )
    ) {
      benefit += 4500;
      reasons.push("actual-trade-throughput");
    }
  }
  if(snapshot.age === "Modern" && ["airstrip","missile-silo","mirv-launcher"].some(type=>
    buildingTechnology(type as Parameters<typeof buildingTechnology>[0],snapshot.age)===technology.id)) {
    benefit+=8000;reasons.push("late-game-capability");
  }
  if (
    snapshot.threatTroops > 0 &&
    technology.tree === "warfare" &&
    technology.capabilities.some((c) =>
      /engineering|fortification|defen/.test(c),
    )
  ) {
    benefit += 6000;
    reasons.push("observed-defense");
  }
  // Deliberate fallback completes two trees toward a usable next age. A landlocked
  // faction does not research a whole naval tree solely because it comes first.
  const next = AGES[AGES.indexOf(snapshot.age) + 1];
  if (
    next &&
    technology.tree !== "naval" &&
    snapshot.readyTroops >= snapshot.threatTroops
  ) {
    benefit += 900 + technology.slot * 150;
    reasons.push("age-prerequisite");
  }
  return { benefit, reason: reasons.join(",") || "no-current-use" };
}
export function usableNextAge(
  snapshot: AiEconomicSnapshot,
  opportunity: ResearchOpportunity,
): boolean {
  const age = AGES[AGES.indexOf(snapshot.age) + 1];
  if (!age) return false;
  // Existing producers can normally upgrade; evaluate the next tier's real input
  // chain before spending the age cost. No speculative goods or free workshops.
  const research = [
    ...snapshot.research,
    ...TECHNOLOGIES.filter((t) => t.age === age && t.slot === 1).map(
      (t) => t.id,
    ),
  ];
  const dependencies = new AiProductionDependencies(
    { ...snapshot, age, research },
    new Set(opportunity.resources),
    opportunity.protectedItems,
  );
  return UNITS.some(
    (u) =>
      u.age === age &&
      snapshot.buildings.some(
        (b) =>
          b.type === u.building && !b.remainingTicks && (b.health ?? 1) > 0,
      ) &&
      Object.entries(u.cost.items ?? {}).every(([id, n]) =>
        dependencies.available(id, n),
      ),
  );
}
