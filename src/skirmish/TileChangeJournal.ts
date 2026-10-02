/** Bounded latest-change journal with independent consumer cursors. No reader
 * drains another reader's changes; overflow/restore requests an exact full scan. */
export class TileChangeJournal {
  private readonly latest = new Map<number, number>();
  private floor = 0;
  revision = 0;
  constructor(private readonly size: number, readonly capacity = 65_536) {
    if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Invalid tile journal capacity");
  }
  record(tile: number): void {
    if (!Number.isInteger(tile) || tile < 0 || tile >= this.size) throw new Error("Invalid changed tile");
    this.latest.delete(tile);
    this.latest.set(tile, ++this.revision);
    if (this.latest.size > this.capacity) {
      const [oldest, revision] = this.latest.entries().next().value!;
      this.floor = revision; this.latest.delete(oldest);
    }
  }
  since(revision: number): number[] | undefined {
    if (revision < this.floor || revision > this.revision) return undefined;
    const tiles: number[] = [];
    for (const [tile, changed] of this.latest) if (changed > revision) tiles.push(tile);
    return tiles;
  }
  invalidate(): void { this.latest.clear(); this.floor = ++this.revision; }
  get retainedTiles(): number { return this.latest.size; }
}
