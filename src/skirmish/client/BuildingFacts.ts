import type { Building } from "../Protocol";

const fields = ["id", "playerId", "type", "tile", "remainingTicks", "buildTicks", "age", "health", "maxHealth", "nextAttackTick", "launchReadyTick"] as const satisfies readonly (keyof Building)[];
/** Copies facts, rather than retaining decoder-owned records that can mutate. */
export class BuildingFacts {
  private previous: readonly Building[] = [];
  reset(): void { this.previous = []; }
  changed(buildings: readonly Building[]): boolean {
    if (this.previous.length === buildings.length && buildings.every((building, i) =>
      fields.every(key => Object.is(building[key], this.previous[i][key])))) return false;
    this.previous = buildings.map(building => ({ ...building }));
    return true;
  }
}
