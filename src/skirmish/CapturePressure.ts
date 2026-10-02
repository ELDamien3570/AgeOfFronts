/** Derived one-tick pressure. Clear only cells written by the previous tick;
 * contested and empty cells keep exactly the original byte-array semantics. */
export class CapturePressure {
  private readonly values: Uint8Array;
  private touched = new Uint32Array(256);
  private count = 0;
  readonly diagnostics = { cleared: 0, touched: 0 };
  constructor(size: number) { this.values = new Uint8Array(size); }
  begin(): void {
    this.diagnostics.cleared = this.count;
    for (let i = 0; i < this.count; i++) this.values[this.touched[i]] = 0;
    this.count = 0;
    this.diagnostics.touched = 0;
  }
  add(tile: number, owner: number): void {
    const previous = this.values[tile];
    if (!previous) {
      if (this.count === this.touched.length) {
        const grown = new Uint32Array(Math.min(this.values.length, this.touched.length * 2));
        grown.set(this.touched); this.touched = grown;
      }
      this.touched[this.count++] = tile;
      this.diagnostics.touched = this.count;
    }
    this.values[tile] = previous === 0 || previous === owner ? owner : 255;
  }
  at(tile: number): number { return this.values[tile]; }
  get retainedBytes(): number { return this.values.byteLength + this.touched.byteLength; }
}
