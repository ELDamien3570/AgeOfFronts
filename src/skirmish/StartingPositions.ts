import type { GameMap } from "../core/game/GameMap";
import { PseudoRandom } from "../core/PseudoRandom";

/** Free tiles kept between two camps beyond their own radii. */
const CAMP_GAP = 4;
/** Rejection draws before a deterministic scan picks the k-th eligible tile. */
const REJECTION_DRAWS = 64;
const NOT_ENOUGH_ROOM =
  "Not enough room for these factions and tribes. Choose fewer opponents or a larger battlefield.";

export interface StartingPositionOptions {
  /**
   * Every radius `next` will be asked for. A camp can only change the clearance
   * of tiles within `radius + CAMP_GAP + max(radii)` of it, and the eligible
   * count of each radius is kept incrementally.
   */
  radii: readonly number[];
  /** Candidate membership by tile; built from the candidates when absent. */
  viable?: Uint8Array;
  /** Reusable clearance buffer (one value per tile); reset on construction. */
  clearance?: Float64Array;
}

/**
 * Seeded uniform sampling among separated camps avoids predictable edge starts.
 * Placing a camp touches only a window around it and drawing one is a handful
 * of random probes, so a 52-faction plan on a 1000x1000 map costs well under a
 * millisecond per camp instead of scanning every candidate (R2-P5).
 */
export class StartingPositions {
  private readonly clearance: Float64Array;
  private readonly viable: Uint8Array;
  private readonly needs: readonly number[];
  /** Candidates whose clearance is at least `needs[i]`. */
  private readonly counts: number[];
  private readonly reach: number;
  constructor(
    private readonly map: GameMap,
    private readonly candidates: readonly number[],
    private readonly random: PseudoRandom,
    { radii, viable, clearance }: StartingPositionOptions,
  ) {
    const tiles = map.width() * map.height();
    this.clearance = clearance ?? new Float64Array(tiles);
    if (this.clearance.length !== tiles)
      throw new Error("Clearance buffer does not match the map");
    this.clearance.fill(Infinity);
    if (viable) this.viable = viable;
    else {
      this.viable = new Uint8Array(tiles);
      for (const candidate of candidates) this.viable[candidate] = 1;
    }
    this.needs = [...new Set(radii)].map((radius) => radius + CAMP_GAP);
    // Nothing is placed yet, so every candidate has unlimited clearance.
    this.counts = this.needs.map(() => candidates.length);
    this.reach = Math.max(0, ...this.needs);
  }
  /** Candidates with room for another camp of this radius. */
  eligible(radius: number): number {
    return this.counts[this.slot(radius)];
  }
  add(tile: number, radius: number): void {
    const { map, clearance, viable, needs, counts } = this;
    const width = map.width(), height = map.height();
    const cx = map.x(tile), cy = map.y(tile);
    // Beyond this distance a candidate stays above every threshold.
    const half = Math.ceil(radius + this.reach);
    const top = Math.max(0, cy - half), bottom = Math.min(height - 1, cy + half);
    const left = Math.max(0, cx - half), right = Math.min(width - 1, cx + half);
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) {
        const candidate = y * width + x;
        if (!viable[candidate]) continue;
        const dx = x - cx, dy = y - cy;
        const value = Math.sqrt(dx * dx + dy * dy) - radius;
        const previous = clearance[candidate];
        if (value >= previous) continue;
        clearance[candidate] = value;
        // Clearance only falls, so each tile leaves a threshold at most once.
        for (let i = 0; i < needs.length; i++)
          if (previous >= needs[i] && value < needs[i]) counts[i]--;
      }
  }
  next(radius: number): number {
    const slot = this.slot(radius);
    const count = this.counts[slot];
    if (!count) throw new Error(NOT_ENOUGH_ROOM);
    const { candidates, clearance } = this;
    const need = this.needs[slot];
    for (let draw = 0; draw < REJECTION_DRAWS; draw++) {
      const candidate = candidates[this.random.nextInt(0, candidates.length)];
      if (clearance[candidate] >= need) {
        this.add(candidate, radius);
        return candidate;
      }
    }
    // Few tiles are left: take the k-th eligible one so the draw still lands.
    let index = this.random.nextInt(0, count);
    for (const candidate of candidates)
      if (clearance[candidate] >= need && index-- === 0) {
        this.add(candidate, radius);
        return candidate;
      }
    throw new Error("Invalid starting-position sample");
  }
  private slot(radius: number): number {
    const slot = this.needs.indexOf(radius + CAMP_GAP);
    if (slot < 0) throw new Error(`Unregistered starting-position radius ${radius}`);
    return slot;
  }
}
