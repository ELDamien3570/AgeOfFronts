/** Derived capture pressure, with sparse one-tick writes or persistent counted
 * contributions. Contested and empty cells retain the byte-array semantics. */
export class CapturePressure {
  private readonly values: Uint8Array;
  private touched = new Uint32Array(256);
  private count = 0;
  private readonly counts: Uint32Array;
  // Allocate owner maps only where different factions actually overlap.
  private readonly contributions = new Map<number, Map<number, number>>();
  private persistent = false;
  readonly diagnostics = { cleared: 0, touched: 0 };
  constructor(size: number) { this.values = new Uint8Array(size);this.counts=new Uint32Array(size); }
  begin(): void {
    if(this.persistent){this.values.fill(0);this.counts.fill(0);this.persistent=false;}
    this.contributions.clear();
    this.diagnostics.cleared = this.count;
    for (let i = 0; i < this.count; i++) this.values[this.touched[i]] = 0;
    this.count = 0;
    this.diagnostics.touched = 0;
  }
  /** Persistent derived contributions: withdrawing one defender must retain
   * other defenders and recover the remaining owner of a contested cell. */
  retain(tile: number, owner: number): void {
    this.persistent=true;
    const count=this.counts[tile],previous=this.values[tile];
    if(count && previous===owner){this.counts[tile]++;return;}
    let counts = this.contributions.get(tile);
    if(!counts) {
      if(!count){this.values[tile]=owner;this.counts[tile]=1;return;}
      this.contributions.set(tile,counts=new Map([[previous,count]]));
      this.counts[tile]=0;
    }
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
    this.values[tile] = counts.size === 1 ? owner : 255;
  }
  withdraw(tile: number, owner: number): void {
    if(this.counts[tile]) {
      if(this.values[tile]!==owner)throw new Error("Missing capture contribution");
      if(--this.counts[tile]===0)this.values[tile]=0;
      return;
    }
    const counts = this.contributions.get(tile);
    if (!counts?.has(owner)) throw new Error("Missing capture contribution");
    const remaining = counts.get(owner)! - 1;
    if (remaining) counts.set(owner, remaining);
    else counts.delete(owner);
    if (!counts.size) { this.contributions.delete(tile); this.values[tile] = 0; }
    else if(counts.size===1) {
      const [remainingOwner,remainingCount]=counts.entries().next().value!;
      this.values[tile]=remainingOwner;this.counts[tile]=remainingCount;this.contributions.delete(tile);
    } else this.values[tile]=255;
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
  /** Fixed buffers only; contested owner maps are additional live storage. */
  get retainedBytes(): number { return this.values.byteLength + this.counts.byteLength + this.touched.byteLength; }
}
