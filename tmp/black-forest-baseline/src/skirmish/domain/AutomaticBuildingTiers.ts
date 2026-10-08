import type { BuildingQueries } from "../BuildingIndex";
import type { Building, BuildingType, Player } from "../Protocol";
import {
  AUTOMATIC_TIER_BUILDINGS,
  automaticBuildingTier,
  buildingIntegrity,
} from "../content/Buildings";
import { AGES, type Age, type ProgressionState } from "./Definitions";

/** Derived tier eligibility; lifecycle writes remain with the authoritative world.
 * Research countdowns do not trigger scans. Restore discards this projection. */
export class AutomaticBuildingTiers {
  private buildingRevision = -1;
  private readonly eligibility = new Map<
    number,
    { age: Age; completed: number; tiers: Map<BuildingType, Age> }
  >();
  reset(): void {
    this.buildingRevision = -1;
    this.eligibility.clear();
  }
  step(
    players: readonly Player[],
    states: Record<number, ProgressionState>,
    facts: BuildingQueries,
    update: (id: number, patch: Partial<Omit<Building, "id">>) => unknown,
  ): void {
    const changed = this.buildingRevision !== facts.producerRevision;
    for (const player of players) {
      const state = states[player.id];
      if (!state || player.eliminated) continue;
      let known = this.eligibility.get(player.id);
      const researched =
        !known ||
        known.age !== state.age ||
        known.completed !== state.completed.length;
      if (researched) {
        const tiers = new Map<BuildingType, Age>();
        for (const type of AUTOMATIC_TIER_BUILDINGS) {
          const age = automaticBuildingTier(type, state.age, state.completed);
          if (age) tiers.set(type, age);
        }
        known = { age: state.age, completed: state.completed.length, tiers };
        this.eligibility.set(player.id, known);
      }
      if (!changed && !researched) continue;
      for (const building of facts.byOwner(player.id)) {
        const age = known!.tiers.get(building.type),
          current = building.age ?? "StoneAge";
        if (
          !age ||
          building.remainingTicks ||
          AGES.indexOf(age) <= AGES.indexOf(current)
        )
          continue;
        const maximum =
          building.maxHealth ?? buildingIntegrity(building.type, current);
        const health = building.health ?? maximum;
        if (health <= 0) continue;
        const maxHealth = buildingIntegrity(building.type, age);
        update(building.id, {
          age,
          maxHealth,
          health: Math.max(
            1,
            Math.floor(maxHealth * Math.min(1, health / maximum)),
          ),
        });
      }
    }
    this.buildingRevision = facts.producerRevision;
  }
}
