/** Stable minimum queue for deterministic terrain construction. */
export class TerrainPriorityQueue {
  private readonly tiles: number[] = [];
  private readonly priorities: number[] = [];
  private readonly secondary: number[] = [];
  private before(p: number, s: number, t: number, index: number): boolean {
    return (
      p < this.priorities[index] ||
      (p === this.priorities[index] &&
        (s < this.secondary[index] ||
          (s === this.secondary[index] && t <= this.tiles[index])))
    );
  }
  get length(): number {
    return this.tiles.length;
  }
  push(tile: number, priority: number, secondary = 0): void {
    let i = this.tiles.length;
    this.tiles.push(tile);
    this.priorities.push(priority);
    this.secondary.push(secondary);
    while (i > 0) {
      const parent = (i - 1) >>> 1,
        p = this.priorities[parent],
        t = this.tiles[parent];
      if (!this.before(priority, secondary, tile, parent)) break;
      this.tiles[i] = t;
      this.priorities[i] = p;
      this.secondary[i] = this.secondary[parent];
      i = parent;
    }
    this.tiles[i] = tile;
    this.priorities[i] = priority;
    this.secondary[i] = secondary;
  }
  pop(): { tile: number; priority: number; secondary: number } {
    if (!this.tiles.length) throw new Error("Empty terrain queue");
    const result = {
        tile: this.tiles[0],
        priority: this.priorities[0],
        secondary: this.secondary[0],
      },
      tile = this.tiles.pop()!,
      priority = this.priorities.pop()!;
    const secondary = this.secondary.pop()!;
    if (this.tiles.length) {
      let i = 0;
      while (i * 2 + 1 < this.tiles.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.tiles.length &&
          this.before(
            this.priorities[child + 1],
            this.secondary[child + 1],
            this.tiles[child + 1],
            child,
          )
        )
          child++;
        const p = this.priorities[child],
          t = this.tiles[child];
        if (this.before(priority, secondary, tile, child)) break;
        this.tiles[i] = t;
        this.priorities[i] = p;
        this.secondary[i] = this.secondary[child];
        i = child;
      }
      this.tiles[i] = tile;
      this.priorities[i] = priority;
      this.secondary[i] = secondary;
    }
    return result;
  }
}
