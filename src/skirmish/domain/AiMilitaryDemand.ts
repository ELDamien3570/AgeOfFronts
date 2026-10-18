import { recruitmentVariant } from '../content/FormationRecipes';
import { scaledRecipeCost } from './Manpower';
import { buildingCost, buildingTechnology } from "../content/Buildings";
import { packageTechnology } from "../content/Technology";import { UNIT, UNITS } from "../content/Units";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import { modernizationTarget } from "./AiMilitaryDevelopment";
import { militaryPosture } from "./AiMilitaryPosture";
import type { AiPersonality } from "./AiPersonality";
import { AiProductionDependencies } from "./AiProductionDependencies";
import { AGES, type Inventory, type UnitDefinition } from "./Definitions";
import { unitRefitCost } from "./Refitting";
import { preferredRecruitmentUnit } from "./AiRecruitmentPolicy";
import { equipmentReserveKind, productionReserveTargets } from "./ProductionReservePolicy";
import { PRODUCTION_RECIPES } from "../content/Production";
import { TECHNOLOGY } from "../content/Technology";

export interface AiDemandPreparation {equipment:Inventory;units:Partial<Record<UnitDefinition["role"],number>>;reserveCosts?:Partial<Record<UnitDefinition["role"],number>>;quote:import("./AiProductionDependencies").AiDependencyQuote;availabilityDeferred:boolean;}
export interface AiProductionDemand {
  /** Exact unpaid reserves for intended role deficits; paid recruitment is already force. */
  manpower?: number;
  resourcePressures?: readonly import("./AiResourcePressure").AiResourcePressure[];
  planning?:AiDemandPreparation;
  equipment: Inventory;
  materials: Inventory;
  units: Partial<Record<UnitDefinition["role"], number>>;
  deferred?: boolean;
  bottlenecks?:readonly {item:string;reason:import("./AiProductionDependencies").AiBottleneckReason}[];
  timeToOutput?:number;
}
export function militaryDemand(
  snapshot: AiEconomicSnapshot,
  personality: AiPersonality,
  renewable: ReadonlySet<string>,
  replacements = 0,
  protectedStock:Readonly<Inventory>={},
  allowance=256,
  saved?:AiDemandPreparation,
): AiProductionDemand {
  const dependencies = new AiProductionDependencies(snapshot, renewable,protectedStock);
  const result: AiProductionDemand = {
    equipment: {},
    materials: {},
    units: {},
  };
  const reserveCosts: Partial<Record<UnitDefinition["role"],number>> = {};
  if (!saved) {
  const posture=militaryPosture(snapshot,personality);
    const antiAir =snapshot.age === "Modern"
        ? Math.max(
            2,snapshot.buildings.filter(
              (b) =>b.type==="city" && (b.health??1)>0,
            ).length * 2,
          )
        : 0;
  const total = Math.min(
    snapshot.cap,
    snapshot.isolated && !snapshot.invasion && snapshot.threatTroops === 0 ? Math.max(personality.minimumRaidSquads,12,posture.target) : Infinity,
    Math.max(
      personality.minimumRaidSquads,
      snapshot.invasion?.squads ?? 0,
      posture.target-antiAir-personality.siegeCopies*2,
      Object.values(snapshot.force.core).reduce((n, v) => n + v, 0) +
        Math.min(8, snapshot.headroom) +
        Math.min(8, replacements),
    ),
  );
  const availableRoles = ([
    ["frontline", personality.recruitment[0]],
    ["ranged", personality.recruitment[1]],
    ["mounted", personality.recruitment[2]],
    ["siege", personality.siegeCopies],
    ["artillery", personality.siegeCopies],
    ["anti-air", antiAir],
  ] as const).flatMap(([role, weight]) => {
    const candidates = [...UNITS]
        .reverse()
        .filter(
          (u) =>
            u.role === role &&
            snapshot.research.includes(u.technologyId) &&
            AGES.indexOf(u.age) <= AGES.indexOf(snapshot.age),
        );
      // Workshops are consequences of intended demand, not prerequisites for
      // expressing it. Keep attainable alternatives when a raw resource is absent.
      const unit =
        candidates.find((u) =>
          Object.entries(
            scaledRecipeCost(u, recruitmentVariant(u.id, snapshot.research))
              .items ?? {},
          ).every(([id, n]) => dependencies.available(id, n)),
        ) ?? candidates[0];
      return unit && weight ? [{ role, weight, unit }] : [];
  });
  // A planned army must still be buildable when cavalry or archery is locked.
  // Redistribute its core demand across the available personality-weighted roles.
  const weights = availableRoles.reduce((sum, r) => sum + (["frontline", "ranged", "mounted"].includes(r.role) ? r.weight : 0), 0);
  for (const { role, weight, unit } of availableRoles) {
    reserveCosts[role] = scaledRecipeCost(unit, recruitmentVariant(unit.id, snapshot.research)).reserves ?? 0;
    const desired = ["frontline", "ranged", "mounted"].includes(role)
      ? Math.ceil((total * weight) / Math.max(1, weights))
      : weight;
    result.units[role] = desired;
    const missing = Math.max(0, desired - snapshot.force.role(role));
    // A paid recruit is already in force.role; its equipment is not requested again.
    const reserve = Math.max(2, Math.min(8, Math.ceil(desired / 3) + replacements));
    const buffer = Math.min(12, Math.min(snapshot.headroom, missing) + reserve);
    for (const [id, n] of Object.entries(scaledRecipeCost(unit,recruitmentVariant(unit.id,snapshot.research)).items ?? {}))
      result.equipment[id] = (result.equipment[id] ?? 0) + buffer * n;
    // Preserve a ready reserve of the intended tier even if today's attainable
      // alternative is older. Temporary starvation must not erase modern demand.
      const preferred = preferredRecruitmentUnit(snapshot, role);
      if (preferred && preferred.id !== unit.id)
        for (const [id, n] of Object.entries(
          scaledRecipeCost(
            preferred,
            recruitmentVariant(preferred.id, snapshot.research),
          ).items ?? {},
        ))
          if (id.startsWith("equipment:"))
            result.equipment[id] = (result.equipment[id] ?? 0) + reserve * n;
  }
  let upgrades = Math.max(1, Math.ceil(snapshot.squads.length / 4));
    for (const squad of snapshot.squads) {
    if (!upgrades || squad.refit || squad.embarkedOn !== null) continue;
    const current = UNIT.get(squad.definitionId ?? `stoneage-${squad.kind}`);
    if (!current) continue;
      const target = modernizationTarget(current, snapshot.research, (u) =>
          Object.entries(unitRefitCost(u,current,1,recruitmentVariant(u.id,snapshot.research)).items ?? {}).every(([id, n]) =>
            dependencies.available(id, n),
          ),
      );
    if (!target) continue;
    upgrades--;
    for (const [id, n] of Object.entries(unitRefitCost(target,current,1,recruitmentVariant(target.id,snapshot.research)).items ?? {}))
      result.equipment[id] = (result.equipment[id] ?? 0) + n;
    }
    if (snapshot.age === "Modern") {
      const cities =snapshot.buildings.filter(
        (b) =>b.type==="city" && (b.health??1)>0,
      ).length;
      const defenses =snapshot.buildings.filter(
        (b) =>b.type==="missile-defence" && (b.health??1)>0,
      ).length;
    if (cities && defenses<cities*(posture.wealthy?10:1) && snapshot.research.includes(buildingTechnology("missile-defence","Modern")!))
      for (const [item,n] of Object.entries(buildingCost("missile-defence","Modern",defenses).items??{})) result.equipment[item]=(result.equipment[item]??0)+n;
      // Stock a small ready salvo through the same dependency/material planner.
      // Aviation and strategic weapons have independent capacity from land squads.
      for (const [type,payload] of [["missile-silo","hydrogen"],["mirv-launcher","mirv"]] as const)
        if (snapshot.buildings.some((b) => b.type === type) && snapshot.research.includes(packageTechnology("Modern",type==="mirv-launcher"?"mirvs-drones":"missile-infrastructure"))
        )
        result.equipment[`payload:${payload}`] = 2;
      if (snapshot.buildings.some((b) =>b.type==="missile-silo") && snapshot.research.includes(packageTechnology("Modern","missile-infrastructure"))
      )
      result.equipment["payload:icbm"]=1;
      const oilUsers =snapshot.buildings.filter((b) =>["depot","arms-factory","airstrip","missile-silo","mirv-launcher"].includes(b.type),
      ).length;
    if(oilUsers)result.equipment.oil=Math.max(40,oilUsers*20);
    }
  }
  if (snapshot.buildings.some((b) =>b.type==="nuclear-facility") && snapshot.research.includes(packageTechnology("EarlyModern","nuclear-weapons"))
  ) result.equipment["payload:atomic"]=2;
  if (!saved) {
    // Capacity must replenish the allocator's actual ready reserve, rather than
    // sizing a single workshop for only the next few paid recruit orders.
    const reserves = productionReserveTargets(
      snapshot.buildings.filter((b) => (b.health ?? 1) > 0),
      snapshot.squads.length,
    );
    for (const kind of ["troop", "siege", "vehicle"] as const) {
      const recipes = PRODUCTION_RECIPES.filter(
        (r) =>
          !r.manualOnly &&
          equipmentReserveKind(r) === kind &&
          snapshot.research.includes(r.technologyId) &&
          Object.keys(r.outputs).some((id) => (result.equipment[id] ?? 0) > 0),
      ).sort(
        (a, b) =>
          AGES.indexOf(TECHNOLOGY.get(b.technologyId)!.age) -
          AGES.indexOf(TECHNOLOGY.get(a.technologyId)!.age),
      );
      const recipe = recipes[0];
      if (recipe)
        for (const id of Object.keys(recipe.outputs))
          result.equipment[id] = Math.max(
            result.equipment[id] ?? 0,
            reserves[kind] + replacements,
          );
    }
  }
  const preparation=saved??{equipment:result.equipment,units:result.units,reserveCosts,quote:dependencies.beginMaterials(result.equipment),availabilityDeferred:dependencies.deferred};
  result.equipment=preparation.equipment; result.units=preparation.units;
  result.manpower = Object.entries(result.units).reduce((sum, [role, desired]) => {
    const key = role as UnitDefinition["role"], unit = preferredRecruitmentUnit(snapshot, key);
    const reserves = preparation.reserveCosts?.[key] ?? (unit ? scaledRecipeCost(unit, recruitmentVariant(unit.id,snapshot.research)).reserves ?? 0 : 0);
    return sum + Math.max(0, desired! - snapshot.force.role(key)) * reserves;
  }, 0);
  dependencies.stepMaterials(preparation.quote,allowance);
  result.materials=preparation.quote.materials; result.bottlenecks=preparation.quote.reasons; result.timeToOutput=preparation.quote.ticks;
  if(preparation.quote.phase!=="done"){result.planning=preparation;result.deferred=true;}
  else if(preparation.availabilityDeferred||dependencies.deferred||preparation.quote.status==="deferred")result.deferred=true;
  return result;
}
