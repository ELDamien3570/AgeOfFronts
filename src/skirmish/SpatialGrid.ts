// A domain index in world coordinates. Camera position and zoom never enter it.
export interface WorldPoint {
  x: number;
  y: number;
}

export class SpatialGrid<T extends WorldPoint> {
  protected readonly buckets: (T[] | undefined)[];
  protected readonly allocated: T[][] = [];
  // Buckets filled since the last rebuild. Once a grid is rebuilt, only these
  // need clearing, so cost follows occupancy and not explored map history.
  protected active: T[][] = [];
  protected tracking = false;
  protected maximumExtent=0;
  protected readonly columns: number;
  private readonly rows: number;
  protected readonly partitions: (number | undefined)[];
  protected readonly occupied: Uint32Array;

  constructor(
    width: number,
    height: number,
    private readonly cellSize: number,
    protected readonly partition?: (item: T) => number,
    protected readonly extent?: (item:T)=>number,
  ) {
    this.columns = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.buckets = new Array(this.columns * this.rows);
    this.occupied = new Uint32Array(Math.ceil(this.buckets.length / 32));
    this.partitions = this.partition ? new Array(this.buckets.length) : [];
  }

  rebuild(items: Iterable<T>): void {
    this.maximumExtent=0;
    this.occupied.fill(0);
    if (this.tracking) {
      for (const bucket of this.active) bucket.length = 0;
      this.active.length = 0;
    } else {
      // Entries added before the first rebuild were not tracked; clear them all
      // once, then follow only occupied buckets.
      for (const bucket of this.allocated) bucket.length = 0;
      this.tracking = true;
    }
    for (const item of items) this.insert(item);
  }

  protected keyOf(item: WorldPoint): number {
    return Math.floor(item.x / this.cellSize) + Math.floor(item.y / this.cellSize) * this.columns;
  }

  insert(item: T): void {
    this.place(item, this.keyOf(item), this.extent?.(item) ?? 0);
  }

  protected place(item: T, key: number, extent: number): void {
    this.maximumExtent=Math.max(this.maximumExtent,extent);
    let bucket = this.buckets[key];
    if (!bucket) {
      this.buckets[key] = bucket = [];
      this.allocated.push(bucket);
    }
    if (this.partition) {
      const owner = this.partition(item);
      this.partitions[key] = !bucket.length
        ? owner
        : this.partitions[key] === owner
          ? owner
          : -1;
    }
    bucket.push(item);
    this.occupied[key >>> 5] |= 1 << (key & 31);
    if (this.tracking && bucket.length === 1) this.active.push(bucket);
  }

  remove(item: T): void {
    const key =
      Math.floor(item.x / this.cellSize) +
      Math.floor(item.y / this.cellSize) * this.columns;
    const bucket = this.buckets[key];
    const index = bucket?.indexOf(item) ?? -1;
    if (index >= 0) {
      bucket!.splice(index, 1);
      if (!bucket!.length) this.occupied[key >>> 5] &= ~(1 << (key & 31));
    }
  }

  /** Conservative occupied-cell test. Rebuild/insert makes a new arrival visible
   * immediately; exact circle/hostility/LOS selection stays in the caller. */
  mayContain(x: number, y: number, radius: number, excludedPartition?: number): boolean {
    const left = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const right = Math.min(this.columns - 1, Math.floor((x + radius) / this.cellSize));
    const top = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const bottom = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));
    if (left > right || top > bottom) return false;
    for (let cy = top; cy <= bottom; cy++) {
      const first = left + cy * this.columns, last = right + cy * this.columns;
      for (let word = first >>> 5; word <= last >>> 5; word++) {
        let bits = this.occupied[word];
        if (word === (first >>> 5)) bits &= 0xffffffff << (first & 31);
        if (word === (last >>> 5)) bits &= 0xffffffff >>> (31 - (last & 31));
        while (bits) {
          const key = word * 32 + 31 - Math.clz32(bits & -bits);
          bits &= bits - 1;
          if (this.buckets[key]?.length &&
              (excludedPartition === undefined || this.partitions[key] !== excludedPartition)) return true;
        }
      }
    }
    return false;
  }

  query(
    x: number,
    y: number,
    radius: number,
    result: T[],
    excludedPartition?: number,
  ): void {
    result.length = 0;
    const left = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const right = Math.min(
      this.columns - 1,
      Math.floor((x + radius) / this.cellSize),
    );
    const top = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const bottom = Math.min(
      this.rows - 1,
      Math.floor((y + radius) / this.cellSize),
    );
    if (left > right || top > bottom) return;
    for (let cy = top; cy <= bottom; cy++) {
      const first = left + cy * this.columns, last = right + cy * this.columns;
      for (let word = first >>> 5; word <= last >>> 5; word++) {
        let bits = this.occupied[word];
        if (word === (first >>> 5)) bits &= 0xffffffff << (first & 31);
        if (word === (last >>> 5)) bits &= 0xffffffff >>> (31 - (last & 31));
        while (bits) {
          const key = word * 32 + 31 - Math.clz32(bits & -bits);
          bits &= bits - 1;
          if (excludedPartition !== undefined && this.partitions[key] === excludedPartition) continue;
          const bucket = this.buckets[key];
          if (bucket) for (const item of bucket) {
              if (excludedPartition !== undefined && this.partition?.(item) === excludedPartition) continue;
              const dx = item.x - x, dy = item.y - y;
              if (dx * dx + dy * dy <= radius * radius) result.push(item);
            }
        }
      }
    }
  }

  /** Conservative envelope candidates; callers retain their own exact legality. */
  queryOverlaps(x:number,y:number,radius:number,result:T[],excludedPartition?:number):void {
    result.length = 0;
    this.visitOverlaps(x, y, radius, item => { result.push(item); return false; }, excludedPartition);
  }
  /** Exact envelope candidates, with early exit for a conservative absence proof.
   * Extents are read live, just as queryOverlaps does; no cached bucket radius
   * may hide an animated or changed body. */
  mayOverlap(x:number,y:number,radius:number,accept:(item:T)=>boolean,excludedPartition?:number):boolean {
    return this.visitOverlaps(x, y, radius, accept, excludedPartition);
  }
  private visitOverlaps(x:number,y:number,radius:number,visit:(item:T)=>boolean,excludedPartition?:number):boolean {
    const reach = radius + this.maximumExtent, squared = reach * reach;
    const left = Math.max(0, Math.floor((x - reach) / this.cellSize)),
      right = Math.min(this.columns - 1, Math.floor((x + reach) / this.cellSize)),
      top = Math.max(0, Math.floor((y - reach) / this.cellSize)),
      bottom = Math.min(this.rows - 1, Math.floor((y + reach) / this.cellSize));
    if (left > right || top > bottom) return false;
    for (let cy = top; cy <= bottom; cy++) {
      const first = left + cy * this.columns, last = right + cy * this.columns;
      for (let word = first >>> 5; word <= last >>> 5; word++) {
        let bits = this.occupied[word];
        if (word === (first >>> 5)) bits &= 0xffffffff << (first & 31);
        if (word === (last >>> 5)) bits &= 0xffffffff >>> (31 - (last & 31));
        while (bits) {
          const key = word * 32 + 31 - Math.clz32(bits & -bits);
          bits &= bits - 1;
          if (excludedPartition !== undefined && this.partitions[key] === excludedPartition) continue;
          const bucket = this.buckets[key];
          if (!bucket) continue;
          for (const item of bucket) {
            if (excludedPartition !== undefined && this.partition?.(item) === excludedPartition) continue;
            const dx = item.x - x, dy = item.y - y, distance = dx * dx + dy * dy;
            if (distance > squared) continue;
            const extent = radius + (this.extent?.(item) ?? 0);
            if (distance <= extent * extent && visit(item)) return true;
          }
        }
      }
    }
    return false;
  }
  /** Bounded advisory neighborhood. Exact collision queries must use query(). */
  sample(x:number,y:number,radius:number,result:T[],accept:(item:T)=>boolean,limit:number,maximumReads:number,offset=0):void {
    result.length=0;
    if(limit<=0 || maximumReads<=0)return;
    let reads=0;
    const left=Math.max(0,Math.floor((x-radius)/this.cellSize)),right=Math.min(this.columns-1,Math.floor((x+radius)/this.cellSize));
    const top=Math.max(0,Math.floor((y-radius)/this.cellSize)),bottom=Math.min(this.rows-1,Math.floor((y+radius)/this.cellSize));
    const width=right-left+1,cells=width*(bottom-top+1);
    if(cells<=0)return;
    for(let at=0;at<cells;at++) {
      const cell=(at+offset)%cells,bucket=this.buckets[left+cell%width+(top+Math.floor(cell/width))*this.columns];
      if(!bucket?.length)continue;
      for(let index=0;index<bucket.length;index++) {
        if(++reads>maximumReads)return;
        const item=bucket[(index+offset)%bucket.length];
        if((item.x-x)**2+(item.y-y)**2<=radius**2 && accept(item)) {
          result.push(item);if(result.length>=limit)return;
        }
      }
    }
  }

  nearest(x: number, y: number, accept: (item: T) => boolean): T | undefined {
    const cx = Math.floor(x / this.cellSize),
      cy = Math.floor(y / this.cellSize);
    let best: T | undefined,
      distance = Infinity;
    for (let ring = 0; ring < Math.max(this.columns, this.rows); ring++) {
      const left = Math.max(0, cx - ring),
        right = Math.min(this.columns - 1, cx + ring);
      const top = Math.max(0, cy - ring),
        bottom = Math.min(this.rows - 1, cy + ring);
      for (let by = top; by <= bottom; by++) {
        // Visit the ring boundary only, in the same row order as a full scan.
        // Rescanning its interior would make distant nearest queries cubic.
        const edgeRow = Math.abs(by - cy) === ring;
        const start = edgeRow ? left : cx - ring;
        const end = edgeRow ? right : cx + ring;
        const stride = edgeRow ? 1 : 2 * ring;
        for (let bx = start; bx <= end; bx += stride) {
          if (bx < 0 || bx >= this.columns) continue;
          for (const item of this.buckets[bx + by * this.columns] ?? []) {
            if (!accept(item)) continue;
            const d = (item.x - x) ** 2 + (item.y - y) ** 2;
            if (d < distance) {
              distance = d;
              best = item;
            }
          }
        }
      }
      // Distance to the closest unvisited cell: no better result can lie beyond.
      const edge = Math.min(
        left > 0 ? x - left * this.cellSize : Infinity,
        right < this.columns - 1 ? (right + 1) * this.cellSize - x : Infinity,
        top > 0 ? y - top * this.cellSize : Infinity,
        bottom < this.rows - 1 ? (bottom + 1) * this.cellSize - y : Infinity,
      );
      if (distance <= edge * edge || edge === Infinity) return best;
    }
    return best;
  }
}

/** A SpatialGrid whose buckets stay in ascending id order (the order a rebuild
 * from an id-sorted source produces) and that can re-index only the items whose
 * position, owner or extent may have changed. After update(changed), the grid
 * equals rebuild(all) from the same id-sorted source: same bucket contents and
 * order, occupancy bits, bucket partitions and maximum extent (I-3). */
export class IncrementalSpatialGrid<T extends WorldPoint & { readonly id: number }> extends SpatialGrid<T> {
  private readonly slots = new Map<T, { key: number; extent: number }>();
  private readonly dirty: number[] = [];
  /** update() calls, rows re-read and bucket moves; diagnostics only. */
  readonly work = { updates: 0, rows: 0, moves: 0 };

  override rebuild(items: Iterable<T>): void {
    this.slots.clear();
    super.rebuild(items);
  }

  override insert(item: T): void {
    const key = this.keyOf(item), extent = this.extent?.(item) ?? 0;
    this.place(item, key, extent);
    this.slots.set(item, { key, extent });
  }

  get size(): number { return this.slots.size; }

  /** Re-index changed items. Every other item must have the same position,
   * owner and extent as when it was last indexed. */
  update(changed: Iterable<T>): void {
    if (!this.tracking) throw new Error("Incremental spatial update before rebuild");
    this.work.updates++;
    const dirty = this.dirty;
    dirty.length = 0;
    // The maximum only needs a full rescan when an item that held it shrank.
    const previousMaximum = this.maximumExtent;
    let maximum = previousMaximum, rescan = false;
    for (const item of changed) {
      const slot = this.slots.get(item);
      if (!slot) throw new Error("Unindexed spatial item");
      this.work.rows++;
      const before = slot.extent;
      slot.extent = this.extent?.(item) ?? 0;
      if (slot.extent > maximum) maximum = slot.extent;
      else if (before === previousMaximum && slot.extent < before) rescan = true;
      const key = this.keyOf(item);
      if (key !== slot.key) {
        this.work.moves++;
        this.detach(slot.key, item);
        dirty.push(slot.key);
        this.attach(key, item);
        slot.key = key;
      }
      // The owner may have changed in place as well.
      if (this.partition) dirty.push(key);
    }
    if (this.partition) for (const key of dirty) {
      const bucket = this.buckets[key];
      if (!bucket?.length) continue;
      let owner: number = this.partition(bucket[0]);
      for (let at = 1; at < bucket.length && owner !== -1; at++) if (this.partition(bucket[at]) !== owner) owner = -1;
      this.partitions[key] = owner;
    }
    if (rescan) {
      maximum = 0;
      for (const slot of this.slots.values()) if (slot.extent > maximum) maximum = slot.extent;
    }
    this.maximumExtent = maximum;
  }

  private detach(key: number, item: T): void {
    const bucket = this.buckets[key], index = bucket?.indexOf(item) ?? -1;
    if (index < 0) throw new Error("Spatial bucket lost an item");
    bucket!.splice(index, 1);
    if (!bucket!.length) this.occupied[key >>> 5] &= ~(1 << (key & 31));
  }

  private attach(key: number, item: T): void {
    let bucket = this.buckets[key];
    if (!bucket) {
      this.buckets[key] = bucket = [];
      this.allocated.push(bucket);
    }
    let low = 0, high = bucket.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (bucket[middle].id < item.id) low = middle + 1; else high = middle;
    }
    bucket.splice(low, 0, item);
    if (bucket.length === 1) {
      this.occupied[key >>> 5] |= 1 << (key & 31);
      // Every non-empty bucket must be listed so the next rebuild clears it.
      this.active.push(bucket);
      if (this.active.length > 2 * this.allocated.length) this.active = this.allocated.filter(b => b.length > 0);
    }
  }
}
