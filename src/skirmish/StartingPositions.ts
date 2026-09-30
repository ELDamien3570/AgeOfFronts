import type { GameMap } from "../core/game/GameMap";

// Incremental farthest-point placement: one linear update per camp, rather
// than comparing every candidate against every earlier camp on each pass.
// Clearance includes each camp's claimed radius, preserving both kinds' land.
export class StartingPositions {
  private readonly clearance: Float64Array;
  constructor(
    private readonly map: GameMap,
    private readonly candidates: readonly number[],
  ) {
    this.clearance = new Float64Array(map.width() * map.height()).fill(
      Infinity,
    );
  }
  add(tile: number, radius: number): void {
    for (const candidate of this.candidates)
      this.clearance[candidate] = Math.min(
        this.clearance[candidate],
        Math.sqrt(this.map.euclideanDistSquared(candidate, tile)) - radius,
      );
  }
  next(radius: number): number {
    let best = -1,
      score = radius + 4;
    for (const candidate of this.candidates)
      if (this.clearance[candidate] >= score) {
        if (best !== -1 && this.clearance[candidate] === score) continue;
        score = this.clearance[candidate];
        best = candidate;
      }
    if (best < 0)
      throw new Error(
        "Not enough room for these factions and tribes. Choose fewer opponents or a larger battlefield.",
      );
    this.add(best, radius);
    return best;
  }
}
