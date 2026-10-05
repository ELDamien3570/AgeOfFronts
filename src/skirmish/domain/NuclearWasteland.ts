import type { GameMap } from "../../core/game/GameMap";
import { FIXED } from "../Protocol";
export const NUCLEAR_RESERVE_LOSS_PER_CELL = 100;
export const FALLOUT_TROOP_LOSS_PER_CELL = 10;

/** Sparse canonical contamination. A cached packed projection changes only
 * when a blast or an actual squad capture changes contamination. */
export class NuclearWasteland {
  private readonly cells = new Map<number, number>();
  private readonly owners = new Map<number, Set<number>>();
  private readonly recovery = new Map<number, readonly number[]>();
  private packed = new Uint32Array();
  private packedRevision = -1;
  revision = 0;
  constructor(private readonly map: GameMap) {}
  has(tile: number): boolean {
    return this.cells.has(tile);
  }
  get size(): number {
    return this.cells.size;
  }
  formerOwner(tile: number): number | undefined {
    return this.cells.get(tile);
  }
  clear(tile: number): boolean {
    const owner = this.cells.get(tile);
    if (owner === undefined) return false;
    this.cells.delete(tile);
    this.owners.get(owner)?.delete(tile);
    this.recovery.delete(owner);
    this.revision++;
    return true;
  }
  recoveryCandidates(owner: number, limit = 32): readonly number[] {
    let rows = this.recovery.get(owner);
    if (!rows) {
      rows = [...(this.owners.get(owner) ?? [])].sort((a, b) => a - b);
      this.recovery.set(owner, rows);
    }
    return rows.slice(0, limit);
  }
  tiles(): Iterable<[number, number]> {
    return this.cells;
  }
  scorch(
    x: number,
    y: number,
    radius: number,
    owner: (tile: number) => number,
    unclaim: (tile: number, previous: number) => void,
  ): void {
    const left = Math.max(0, Math.ceil((x - radius) / FIXED - 0.5)),
      right = Math.min(
        this.map.width() - 1,
        Math.floor((x + radius) / FIXED - 0.5),
      );
    const top = Math.max(0, Math.ceil((y - radius) / FIXED - 0.5)),
      bottom = Math.min(
        this.map.height() - 1,
        Math.floor((y + radius) / FIXED - 0.5),
      );
    for (let cy = top; cy <= bottom; cy++)
      for (let cx = left; cx <= right; cx++) {
        const tile = this.map.ref(cx, cy);
        if (
          !this.map.isLand(tile) ||
          ((cx + 0.5) * FIXED - x) ** 2 + ((cy + 0.5) * FIXED - y) ** 2 >
            radius ** 2
        )
          continue;
        const previous = owner(tile);
        const existing = this.cells.has(tile);
        if (!existing) {
          this.cells.set(tile, previous);
          const owned = this.owners.get(previous) ?? new Set<number>();
          owned.add(tile);
          this.owners.set(previous, owned);
          this.recovery.delete(previous);
          this.revision++;
        }
        // Overlapping salvos do not repeatedly dirty already-neutral fallout.
        if (previous || !existing) unclaim(tile, previous);
      }
  }
  snapshot(): Uint32Array {
    if (this.packedRevision !== this.revision) {
      this.packed = Uint32Array.from(
        [...this.cells.keys()].sort((a, b) => a - b),
      );
      this.packedRevision = this.revision;
    }
    return this.packed;
  }
  checkpoint(): [number, number][] {
    return [...this.cells];
  }
  restore(rows: readonly [number, number][]): void {
    const validated = new Map<number, number>();
    for (const [tile, owner] of rows) {
      if (
        !Number.isSafeInteger(tile) ||
        tile < 0 ||
        tile >= this.map.width() * this.map.height() ||
        !this.map.isLand(tile) ||
        !Number.isSafeInteger(owner) ||
        owner < 0 ||
        owner >= 255 ||
        validated.has(tile)
      )
        throw new Error("Invalid nuclear wasteland");
      validated.set(tile, owner);
    }
    this.cells.clear();
    this.owners.clear();
    this.recovery.clear();
    for (const [tile, owner] of validated) {
      this.cells.set(tile, owner);
      const owned = this.owners.get(owner) ?? new Set<number>();
      owned.add(tile);
      this.owners.set(owner, owned);
    }
    this.revision++;
    this.packedRevision = -1;
  }
}
