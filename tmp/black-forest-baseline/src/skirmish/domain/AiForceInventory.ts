import type { ShipType, Squad } from "../Protocol";
import { UNIT, defaultUnit } from "../content/Units";
import type { RecruitmentJob, UnitDefinition } from "./Definitions";

// Paid training is committed force, not another resource reservation. Build
// this derived index once per decision pass; never persist cache warmth.
export class AiForceInventory {
  readonly core = { infantry: 0, archer: 0, cavalry: 0 };
  private readonly roles = new Map<UnitDefinition["role"], number>();
  private readonly ships = new Map<ShipType, number>();
  private readonly aircraft = new Map<string, number>();
  constructor(
    playerId: number,
    squads: readonly Squad[],
    jobs: readonly RecruitmentJob[],
  ) {
    const land = (unit: UnitDefinition) => {
      this.roles.set(unit.role, (this.roles.get(unit.role) ?? 0) + 1);
      if (["frontline", "ranged", "mounted"].includes(unit.role))
        this.core[unit.line]++;
    };
    for (const squad of squads)
      if (squad.playerId === playerId && squad.troops > 0)
        land(UNIT.get(squad.definitionId ?? "") ?? defaultUnit(squad.kind));
    for (const job of jobs) {
      if (job.playerId !== playerId) continue;
      if (job.category === "land") {
        const unit =
          UNIT.get(job.definitionId ?? "") ??
          defaultUnit(job.kind as Squad["kind"]);
        land(unit);
      } else if (job.category === "ship") {
        const kind = job.kind as ShipType;
        this.ships.set(kind, (this.ships.get(kind) ?? 0) + 1);
      } else
        this.aircraft.set(job.kind, (this.aircraft.get(job.kind) ?? 0) + 1);
    }
  }
  role(role: UnitDefinition["role"]): number {
    return this.roles.get(role) ?? 0;
  }
  queuedShips(kind: ShipType): number {
    return this.ships.get(kind) ?? 0;
  }
  queuedAircraft(kind: string): number {
    return this.aircraft.get(kind) ?? 0;
  }
}
