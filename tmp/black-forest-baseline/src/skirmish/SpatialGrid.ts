// A domain index in world coordinates. Camera position and zoom never enter it.
export interface WorldPoint {
  x: number;
  y: number;
}

export class SpatialGrid<T extends WorldPoint> {
  private readonly buckets: (T[] | undefined)[];
  private readonly allocated: T[][] = [];
  // Buckets filled since the last rebuild. Once a grid is rebuilt, only these
  // need clearing, so cost follows occupancy and not explored map history.
  private readonly active: T[][] = [];
  private tracking = false;
  private readonly columns: number;
  private readonly rows: number;
  private readonly partitions: (number | undefined)[];

  constructor(
    width: number,
    height: number,
    private readonly cellSize: number,
    private readonly partition?: (item: T) => number,
  ) {
    this.columns = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.buckets = new Array(this.columns * this.rows);
    this.partitions = this.partition ? new Array(this.buckets.length) : [];
  }

  rebuild(items: Iterable<T>): void {
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

  insert(item: T): void {
    const key =
      Math.floor(item.x / this.cellSize) +
      Math.floor(item.y / this.cellSize) * this.columns;
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
    if (this.tracking && bucket.length === 1) this.active.push(bucket);
  }

  remove(item: T): void {
    const key =
      Math.floor(item.x / this.cellSize) +
      Math.floor(item.y / this.cellSize) * this.columns;
    const bucket = this.buckets[key];
    const index = bucket?.indexOf(item) ?? -1;
    if (index >= 0) bucket!.splice(index, 1);
  }

  /** Conservative occupied-cell test. Rebuild/insert makes a new arrival visible
   * immediately; exact circle/hostility/LOS selection stays in the caller. */
  mayContain(x: number, y: number, radius: number, excludedPartition?: number): boolean {
    const left = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const right = Math.min(this.columns - 1, Math.floor((x + radius) / this.cellSize));
    const top = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const bottom = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));
    for (let cy = top; cy <= bottom; cy++)
      for (let cx = left; cx <= right; cx++) {
        const key = cx + cy * this.columns;
        if (this.buckets[key]?.length &&
            (excludedPartition === undefined || this.partitions[key] !== excludedPartition)) return true;
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
    for (let cy = top; cy <= bottom; cy++)
      for (let cx = left; cx <= right; cx++) {
        const key = cx + cy * this.columns;
        if (
          excludedPartition !== undefined &&
          this.partitions[key] === excludedPartition
        )
          continue;
        const bucket = this.buckets[key];
        if (bucket)
          for (const item of bucket) {
            if (
              excludedPartition !== undefined &&
              this.partition?.(item) === excludedPartition
            )
              continue;
            const dx = item.x - x,
              dy = item.y - y;
            if (dx * dx + dy * dy <= radius * radius) result.push(item);
          }
      }
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
