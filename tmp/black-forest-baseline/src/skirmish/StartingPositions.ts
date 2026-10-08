import type { GameMap } from "../core/game/GameMap";
import { PseudoRandom } from "../core/PseudoRandom";

// Seeded uniform sampling among separated camps avoids predictable edge starts.
export class StartingPositions {
  private readonly clearance: Float64Array;
  constructor(
    private readonly map: GameMap,
    private readonly candidates: readonly number[],
    private readonly random = new PseudoRandom(1),
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
    let count = 0;
    for (const candidate of this.candidates)
      if (this.clearance[candidate] >= radius + 4) count++;
    if (!count)
      throw new Error(
        "Not enough room for these factions and tribes. Choose fewer opponents or a larger battlefield.",
      );
    let index = this.random.nextInt(0, count);
    for (const candidate of this.candidates)
      if (this.clearance[candidate] >= radius + 4 && index-- === 0) {
        this.add(candidate, radius);
        return candidate;
      }
    throw new Error("Invalid starting-position sample");
  }
}
