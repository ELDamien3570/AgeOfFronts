import { restoreMap } from "../StateTransfer";
import type { Building, Player, Squad } from "../Protocol";
import { producerCompatible } from "../content/Buildings";
import { UNIT, UNITS } from "../content/Units";
import {
  AGES,
  type Inventory,
  type ProductionRecipe,
  type UnitDefinition,
} from "./Definitions";
import { unitRefitCost } from "./Refitting";

export function newestMilitaryUnits(
  research: readonly string[],
): UnitDefinition[] {
  const roles = new Map<string, UnitDefinition>();
  for (const unit of UNITS)
    if (research.includes(unit.technologyId))
      roles.set(`${unit.line}:${unit.troopClass ?? unit.role}`, unit);
  return [...roles.values()];
}

// A production policy emits normal production commands. Supply remains the
// authority for payment, paid batches and completion; the AI grants no goods.
export function militaryProduction(
  buildings: readonly Building[],
  research: readonly string[],
  inventory: Inventory,
  recipes: readonly ProductionRecipe[],
  incoming: Inventory,
  squadCount: number,
): Map<number, string | null> {
  const available = recipes.filter((r) => !r.manualOnly && research.includes(r.technologyId));
  const producer = new Map(
    available.flatMap((r) =>
      Object.keys(r.outputs).map((id) => [id, r] as const),
    ),
  );
  const desired: Inventory = {},
    weights: Inventory = {};
  const demand = (id: string, amount: number, weight = 1, depth = 0) => {
    if (depth > 8) throw new Error("Cyclic production dependency");
    weights[id] = Math.max(weights[id] ?? 0, weight);
    if ((desired[id] ?? 0) >= amount) return;
    desired[id] = amount;
    const recipe = producer.get(id);
    if (!recipe) return;
    const batches = Math.ceil(
      Math.max(0, amount - (inventory[id] ?? 0) - (incoming[id] ?? 0)) /
        recipe.outputs[id],
    );
    for (const [input, n] of Object.entries(recipe.inputs))
      demand(input, n * batches, weight * 0.95, depth + 1);
  };
  for (const unit of newestMilitaryUnits(research)) {
    const core = ["frontline", "ranged", "mounted"].includes(unit.role);
    for (const [id, n] of Object.entries(unit.cost.items ?? {}))
      demand(
        id,
        n * (core ? Math.max(6, Math.min(20, Math.ceil(squadCount / 4))) : 2),
        core ? 3 : 1,
      );
  }
  // Strategic payloads have demand beyond land-unit equipment. Aircraft are
  // recruited with gold and time and do not need a manufacturing pattern.
  for (const recipe of available)
    if (
      Object.keys(recipe.outputs).some((id) => id.startsWith("payload:")) &&
      buildings.some((b) => producerCompatible(b.type, recipe.building))
    )
      for (const id of Object.keys(recipe.outputs))
        demand(id, 2, id.startsWith("payload:") ? 0.15 : 0.6);

  const allocated = { ...incoming },
    result = new Map<number, string | null>();
  for (const building of [...buildings].sort((a, b) => a.id - b.id)) {
    if (building.remainingTicks) continue;
    const candidates = available.filter((r) =>
      producerCompatible(building.type, r.building),
    );
    if (!candidates.length) continue;
    const pressure = (recipe: ProductionRecipe) =>
      Math.max(
        ...Object.keys(recipe.outputs).map(
          (id) =>
            (Math.max(
              0,
              (desired[id] ?? 0) - (inventory[id] ?? 0) - (allocated[id] ?? 0),
            ) /
              Math.max(1, desired[id] ?? 0)) *
            (weights[id] ?? 0),
        ),
      );
    const recipe = candidates
      .filter(
        (r) =>
          Object.entries(r.inputs).every(
            ([id, n]) => (inventory[id] ?? 0) >= n,
          ) && pressure(r) > 0,
      )
      .sort(
        (a, b) => pressure(b) - pressure(a) || a.id.localeCompare(b.id, "en"),
      )[0];
    result.set(building.id, recipe?.id ?? null);
    if (recipe)
      for (const [id, n] of Object.entries(recipe.outputs))
        allocated[id] = (allocated[id] ?? 0) + n;
  }
  return result;
}

export interface ModernizationLease {
  targetId: string;
  startedTick: number;
}
/** One class-preserving candidate order shared by kit demand and refit leases.
 * Availability policy belongs to the caller; no free equipment or era jumps. */
export function modernizationTarget(current: UnitDefinition, research: readonly string[], attainable: (unit: UnitDefinition) => boolean): UnitDefinition | undefined {
  return [...UNITS].reverse().find(u => u.line === current.line &&
    (u.troopClass ?? u.role) === (current.troopClass ?? current.role) &&
    AGES.indexOf(u.age) > AGES.indexOf(current.age) && research.includes(u.technologyId) && attainable(u));
}
export class AiModernization {
  checkpoint() { return structuredClone({leases:this.leases}); }
  restore(saved: ReturnType<AiModernization["checkpoint"]>): void {
    const state=structuredClone(saved);
    restoreMap(this.leases,state.leases);

  }

  readonly leases = new Map<number, ModernizationLease>();
  holds(squadId: number): boolean {
    return this.leases.has(squadId);
  }
  clean(squads: readonly Squad[], tick: number): void {
    const live = new Map(squads.map((s) => [s.id, s]));
    for (const [id, lease] of this.leases) {
      const squad = live.get(id);
      if (
        !squad ||
        squad.definitionId === lease.targetId ||
        squad.embarkedOn !== null ||
        (!squad.refit && tick - lease.startedTick > 600)
      )
        this.leases.delete(id);
    }
  }
  reserve(
    player: Player,
    squads: readonly Squad[],
    research: readonly string[],
    inventory: Inventory,
    tick: number,
  ): void {
    const remaining = { ...inventory };
    let gold = player.gold;
    for (const squad of squads) {
      const lease = this.leases.get(squad.id);
      const target = lease && UNIT.get(lease.targetId);
      if (!target || squad.refit) continue;
      const cost = unitRefitCost(target);
      gold -= cost.gold ?? 0;
      for (const [id,n] of Object.entries(cost.items ?? {})) remaining[id] = (remaining[id] ?? 0)-n;
    }
    let count = squads.filter((s) => this.holds(s.id) || s.refit).length;
    const budget = Math.max(1, Math.ceil(squads.length / 4));
    for (const squad of [...squads].sort((a, b) => a.id - b.id)) {
      if (count >= budget) break;
      if (
        this.holds(squad.id) ||
        squad.refit ||
        squad.charge
      )
        continue;
      const current = UNIT.get(squad.definitionId ?? "stoneage-" + squad.kind)!;
      if (!current) continue;
      const target = modernizationTarget(current, research, u => {
        const cost = unitRefitCost(u);
        return gold >= (cost.gold ?? 0) && Object.entries(cost.items ?? {}).every(([id,n]) => (remaining[id] ?? 0) >= n);
      });
      if (!target) continue;
      const cost = unitRefitCost(target);
      if (
        gold < cost.gold! ||
        Object.entries(cost.items ?? {}).some(
          ([id, n]) => (remaining[id] ?? 0) < n,
        )
      )
        continue;
      gold -= cost.gold!;
      for (const [id, n] of Object.entries(cost.items ?? {}))
        remaining[id] -= n;
      this.leases.set(squad.id, { targetId: target.id, startedTick: tick });
      count++;
    }
  }
}
