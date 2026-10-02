import { UNIT, UNITS } from "../content/Units";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import type { AiPersonality } from "./AiPersonality";
import { AiProductionDependencies } from "./AiProductionDependencies";
import { AGES, type Inventory, type UnitDefinition } from "./Definitions";
import { unitRefitCost } from "./Refitting";

export interface AiProductionDemand {
  equipment: Inventory;
  materials: Inventory;
  units: Partial<Record<UnitDefinition["role"], number>>;
  deferred?: boolean;
}
export function militaryDemand(
  snapshot: AiEconomicSnapshot,
  personality: AiPersonality,
  renewable: ReadonlySet<string>,
  replacements = 0,
): AiProductionDemand {
  const dependencies = new AiProductionDependencies(snapshot, renewable);
  const result: AiProductionDemand = {
    equipment: {},
    materials: {},
    units: {},
  };
  const total = Math.min(
    snapshot.cap,
    Math.max(
      personality.minimumRaidSquads,
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
    ["anti-air", snapshot.age === "Modern" ? 2 : 0],
  ] as const) {
    const unit = [...UNITS]
      .reverse()
      .find(
        (u) =>
          u.role === role &&
          snapshot.research.includes(u.technologyId) &&
          snapshot.buildings.some(
            (b) =>
              b.type === u.building &&
              !b.remainingTicks &&
              (b.health ?? 1) > 0 &&
              AGES.indexOf(b.age ?? "StoneAge") >= AGES.indexOf(u.age),
          ) &&
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
  result.materials = dependencies.materials(result.equipment);
  if (dependencies.deferred) result.deferred = true;
  return result;
}
