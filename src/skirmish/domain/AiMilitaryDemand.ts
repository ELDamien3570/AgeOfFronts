import { UNIT, UNITS } from "../content/Units";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import type { AiPersonality } from "./AiPersonality";
import { AiProductionDependencies } from "./AiProductionDependencies";
import { AGES, type Inventory, type UnitDefinition } from "./Definitions";
import { unitRefitCost } from "./Refitting";
import { buildingTechnology, buildingCost } from "../content/Buildings";
import { technologyAt, packageTechnology } from "../content/Technology";
import { militaryPosture } from "./AiMilitaryPosture";

export interface AiDemandPreparation {equipment:Inventory;units:Partial<Record<UnitDefinition["role"],number>>;quote:import("./AiProductionDependencies").AiDependencyQuote;availabilityDeferred:boolean;}
export interface AiProductionDemand {
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
  if(!saved){
  const posture=militaryPosture(snapshot,personality);
  const antiAir=snapshot.age==="Modern" ? Math.max(2,snapshot.buildings.filter(b=>b.type==="city" && (b.health??1)>0).length*2) : 0;
  const total = Math.min(
    snapshot.cap,
    snapshot.isolated && snapshot.threatTroops === 0 && !posture.wealthy ? Math.max(personality.minimumRaidSquads,12) : Infinity,
    Math.max(
      personality.minimumRaidSquads,
      posture.target-antiAir-personality.siegeCopies*2,
      Object.values(snapshot.force.core).reduce((n, v) => n + v, 0) +
        Math.min(8, snapshot.headroom) +
        Math.min(8, replacements),
    ),
  );
  const weights = personality.recruitment.reduce((a, b) => a + b, 0);
  for (const [role, weight] of [
    ["frontline", personality.recruitment[0]],
    ["ranged", personality.recruitment[1]],
    ["mounted", personality.recruitment[2]],
    ["siege", personality.siegeCopies],
    ["artillery", personality.siegeCopies],
    ["anti-air", antiAir],
  ] as const) {
    const unit = [...UNITS]
      .reverse()
      .find(
        (u) =>
          u.role === role &&
          snapshot.research.includes(u.technologyId) &&
          ((snapshot.age === "Modern" && snapshot.research.includes(buildingTechnology(u.building,snapshot.age) ?? "")) || snapshot.buildings.some(
            (b) =>
              b.type === u.building &&
              !b.remainingTicks &&
              (b.health ?? 1) > 0 &&
              AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(u.age),
          )) &&
          Object.entries(u.cost.items ?? {}).every(([id, n]) =>
            dependencies.available(id, n),
          ),
      );
    if (!unit || !weight) continue;
    const desired = ["frontline", "ranged", "mounted"].includes(role)
      ? Math.ceil((total * weight) / weights)
      : weight;
    result.units[role] = desired;
    const missing = Math.max(0, desired - snapshot.force.role(role));
    // A paid recruit is already in force.role; its equipment is not requested again.
    const buffer = Math.min(
      8,
      Math.min(snapshot.headroom, missing) +
        (snapshot.headroom > 0 ? (snapshot.threatTroops > 0 ? 2 : 1) : 0),
    );
    for (const [id, n] of Object.entries(unit.cost.items ?? {}))
      result.equipment[id] = (result.equipment[id] ?? 0) + buffer * n;
  }
  let upgrades = Math.max(1, Math.ceil(snapshot.squads.length / 4));
  for (const squad of snapshot.squads) {
    if (!upgrades || squad.refit || squad.embarkedOn !== null) continue;
    const current = UNIT.get(squad.definitionId ?? `stoneage-${squad.kind}`);
    if (!current) continue;
    const target = [...UNITS]
      .reverse()
      .find(
        (u) =>
          u.line === current.line &&
          u.role === current.role &&
          AGES.indexOf(u.age) > AGES.indexOf(current.age) &&
          snapshot.research.includes(u.technologyId) &&
          Object.entries(unitRefitCost(u).items ?? {}).every(([id, n]) =>
            dependencies.available(id, n),
          ),
      );
    if (!target) continue;
    upgrades--;
    for (const [id, n] of Object.entries(unitRefitCost(target).items ?? {}))
      result.equipment[id] = (result.equipment[id] ?? 0) + n;
  }
  if(snapshot.age === "Modern") {
    const cities=snapshot.buildings.filter(b=>b.type==="city" && (b.health??1)>0).length;
    const defenses=snapshot.buildings.filter(b=>b.type==="missile-defence" && (b.health??1)>0).length;
    if (cities && defenses<cities*(posture.wealthy?10:1) && snapshot.research.includes(buildingTechnology("missile-defence","Modern")!))
      for (const [item,n] of Object.entries(buildingCost("missile-defence","Modern",defenses).items??{})) result.equipment[item]=(result.equipment[item]??0)+n;
    // Stock a small ready salvo through the same dependency/material planner.
    // Aviation and strategic weapons have independent capacity from land squads.
    for(const [type,payload] of [["missile-silo","hydrogen"],["mirv-launcher","mirv"]] as const)
      if(snapshot.buildings.some(b=>b.type===type) && snapshot.research.includes(packageTechnology("Modern",type==="mirv-launcher"?"mirvs-drones":"missile-infrastructure")))
        result.equipment[`payload:${payload}`]=2;
    if(snapshot.buildings.some(b=>b.type==="missile-silo") && snapshot.research.includes(packageTechnology("Modern","missile-infrastructure")))
      result.equipment["payload:icbm"]=1;
    const oilUsers=snapshot.buildings.filter(b=>["depot","arms-factory","airstrip","missile-silo","mirv-launcher"].includes(b.type)).length;
    if(oilUsers)result.equipment.oil=Math.max(40,oilUsers*20);
  }
  }
  const preparation=saved??{equipment:result.equipment,units:result.units,quote:dependencies.beginMaterials(result.equipment),availabilityDeferred:dependencies.deferred};
  result.equipment=preparation.equipment;result.units=preparation.units;
  dependencies.stepMaterials(preparation.quote,allowance);
  result.materials=preparation.quote.materials;result.bottlenecks=preparation.quote.reasons;result.timeToOutput=preparation.quote.ticks;
  if(preparation.quote.phase!=="done"){result.planning=preparation;result.deferred=true;}
  else if(preparation.availabilityDeferred||dependencies.deferred||preparation.quote.status==="deferred")result.deferred=true;
  return result;
}
