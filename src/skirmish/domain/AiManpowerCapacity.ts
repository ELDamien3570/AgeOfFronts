import { secondsToTicks } from "../Protocol";
import { cityReserveIncome } from "../content/Economy";
import { recruitmentVariant } from "../content/FormationRecipes";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import { AI_CAPACITY_SECONDS } from "./AiInfrastructureCapacity";
import type { AiProductionDemand } from "./AiMilitaryDemand";
import { preferredRecruitmentUnit } from "./AiRecruitmentPolicy";
import type { UnitDefinition } from "./Definitions";
import { scaledRecipeCost } from "./Manpower";

/** Advisory manpower throughput in authoritative reserve units. Paid recruits
 * already left stock and force.role includes their committed squads. */
export function manpowerCapacity(
  snapshot: AiEconomicSnapshot,
  demand?: AiProductionDemand,
) {
  const required =
    demand?.manpower ??
    Object.entries(demand?.units ?? {}).reduce((sum, [role, count]) => {
      const key = role as UnitDefinition["role"],
        unit = preferredRecruitmentUnit(snapshot, key);
      return (
        sum +
        Math.max(0, count! - snapshot.force.role(key)) *
          (unit
            ? (scaledRecipeCost(
                unit,
                recruitmentVariant(unit.id, snapshot.research),
              ).reserves ?? 0)
            : 0)
      );
    }, 0);
  // Simulation.applyReservePoints converts authored income by 12/1000.
  let incoming = 0;
  const tileDelay = new Map<number, number>();
  for (const building of [...snapshot.buildings].sort((a, b) => a.id - b.id)) {
    if (building.remainingTicks <= 0 || (building.health ?? 1) <= 0) continue;
    const delay = (tileDelay.get(building.tile) ?? 0) + building.remainingTicks;
    tileDelay.set(building.tile, delay);
    if (building.type === "city")
      incoming +=
        (Math.max(0, AI_CAPACITY_SECONDS - delay / secondsToTicks(1)) *
          cityReserveIncome(building.age ?? snapshot.age, snapshot.research) *
          12) /
        1000;
  }
  const available =
    (snapshot.liquid.reserves ?? 0) +
    snapshot.reserveIncome * AI_CAPACITY_SECONDS +
    incoming;
  const shortage = Math.max(0, required - available);
  const cityGain =
    ((cityReserveIncome(snapshot.age, snapshot.research) * 12) / 1000) *
    AI_CAPACITY_SECONDS;
  return {
    required,
    available,
    shortage,
    extraCities: Math.ceil(shortage / Math.max(1, cityGain)),
  };
}
