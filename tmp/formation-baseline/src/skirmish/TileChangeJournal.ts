import { LatestChangeIndex } from "./LatestChangeIndex";

/** Bounded latest-change journal with independent consumer cursors. No reader
 * drains another reader's changes; overflow/restore requests an exact full scan. */
export class TileChangeJournal {
  private readonly latest: LatestChangeIndex<{ revision: number }>;
  revision = 0;
  constructor(private readonly size: number, readonly capacity = 65_536) {
    if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Invalid tile journal capacity");
    this.latest = new LatestChangeIndex(capacity);
  }
  record(tile: number): void {
    if (!Number.isInteger(tile) || tile < 0 || tile >= this.size) throw new Error("Invalid changed tile");
    this.latest.set(tile, { revision: ++this.revision });
  }
  since(revision: number): number[] | undefined {
    if (revision < this.latest.floor || revision > this.revision) return undefined;
    return this.latest.since(revision).map(row => row.id);
  }
  invalidate(): void { this.latest.clear(++this.revision); }
  get retainedTiles(): number { return this.latest.size; }
  get diagnostics() { return this.latest.diagnostics; }
}
