import type { Player } from "../Protocol";
import type { Expansion } from "./Expansion";
export interface AiForceReadiness {
  squads: number;
  troops: number;
  frontline: number;
  ranged: number;
  mobile: number;
  siege: number;
  logistics: boolean;
  reason: "ready" | "force" | "roles" | "logistics" | "leased";
}
/** Shared live owner facts for strategic declarations and Army preparation. */
export function forceReadiness(
  expansion: Expansion,
  player: Player,
  minimum: number,
): AiForceReadiness {
  const result: AiForceReadiness = {
    squads: 0,
    troops: 0,
    frontline: 0,
    ranged: 0,
    mobile: 0,
    siege: 0,
    logistics: false,
    reason: "force",
  };
  for (const squad of expansion.world.squadFacts().aliveByOwner(player.id)) {
    const lease = expansion.economy.assets.leases.get(`squad:${squad.id}`);
    if (
      squad.troops < 500 ||
      squad.embarkedOn !== null ||
      squad.refit ||
      squad.charge ||
      squad.structureTarget ||
      (lease && !["operation", "patrol"].includes(lease.priority))
    )
      continue;
    const unit = expansion.unit(squad);
    result.squads++;
    result.troops += squad.troops;
    if (unit.role === "frontline") result.frontline++;
    if (["ranged", "artillery"].includes(unit.role)) result.ranged++;
    if (unit.role === "mounted") result.mobile++;
    if (["siege", "artillery"].includes(unit.role)) result.siege++;
  }
  const own = expansion.world.buildingFacts().byOwner(player.id);
  result.logistics =
    player.reserves >= 1000 ||
    own.some(
      (b) =>
        ["city", "depot", "barracks"].includes(b.type) &&
        !b.remainingTicks &&
        (b.health ?? 1) > 0,
    );
  result.reason =
    result.squads < minimum
      ? "force"
      : !result.frontline && !result.ranged && !result.mobile
        ? "roles"
        : !result.logistics
          ? "logistics"
          : "ready";
  return result;
}
