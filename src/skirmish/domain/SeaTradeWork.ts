/** Indexed heap: one entry per ID, no lazy tombstones or polling growth. */
export class SeaWorkHeap<K> {
  private rows: K[] = [];
  private positions = new Map<K, number>();
  constructor(private readonly less: (a: K, b: K) => boolean) {}
  get size(): number { return this.rows.length; }
  first(): K | undefined { return this.rows[0]; }
  has(key: K): boolean { return this.positions.has(key); }
  clear(): void { this.rows = []; this.positions.clear(); }
  update(key: K): void {
    const old = this.positions.get(key);
    if (old === undefined) { this.positions.set(key, this.rows.length); this.rows.push(key); }
    const at = this.up(this.positions.get(key)!); this.down(at);
  }
  remove(key: K): boolean {
    const at = this.positions.get(key); if (at === undefined) return false;
    this.positions.delete(key);
    const last = this.rows.pop()!;
    if (at < this.rows.length) {
      this.rows[at] = last; this.positions.set(last, at);
      this.down(this.up(at));
    }
    return true;
  }
  pop(): K | undefined { const key = this.first(); if (key !== undefined) this.remove(key); return key; }
  private swap(a: number, b: number): void {
    [this.rows[a], this.rows[b]] = [this.rows[b], this.rows[a]];
    this.positions.set(this.rows[a], a); this.positions.set(this.rows[b], b);
  }
  private up(start: number): number {
    let at = start;
    while (at) { const parent = (at - 1) >>> 1; if (!this.less(this.rows[at], this.rows[parent])) break; this.swap(at, parent); at = parent; }
    return at;
  }
  private down(start: number): void {
    let at = start;
    for (;;) {
      let child = at * 2 + 1; if (child >= this.rows.length) return;
      if (child + 1 < this.rows.length && this.less(this.rows[child + 1], this.rows[child])) child++;
      if (!this.less(this.rows[child], this.rows[at])) return;
      this.swap(at, child); at = child;
    }
  }
}

/** Removable FIFO with O(1) links; checkpoint only its logical order. */
export class SeaWorkQueue<K> {
  private nodes = new Map<K, { previous?: K; next?: K }>();
  private head?: K;
  private tail?: K;
  get size(): number { return this.nodes.size; }
  has(key: K): boolean { return this.nodes.has(key); }
  add(key: K): void {
    if (this.nodes.has(key)) return;
    this.nodes.set(key, { previous: this.tail });
    if (this.tail !== undefined) this.nodes.get(this.tail)!.next = key;
    else this.head = key;
    this.tail = key;
  }
  remove(key: K): void {
    const node = this.nodes.get(key); if (!node) return;
    if (node.previous === undefined) this.head = node.next;
    else this.nodes.get(node.previous)!.next = node.next;
    if (node.next === undefined) this.tail = node.previous;
    else this.nodes.get(node.next)!.previous = node.previous;
    this.nodes.delete(key);
  }
  pop(): K | undefined { const key = this.head; if (key !== undefined) this.remove(key); return key; }
  values(): K[] { const result: K[] = []; for (let k = this.head; k !== undefined; k = this.nodes.get(k)!.next) result.push(k); return result; }
  clear(): void { this.nodes.clear(); this.head = this.tail = undefined; }
}
