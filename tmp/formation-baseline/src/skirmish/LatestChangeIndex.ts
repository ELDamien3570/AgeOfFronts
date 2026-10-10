interface Entry<T> {
  value: T;
  previous?: number;
  next?: number;
}

/** Bounded latest records ordered by write revision. Backward reads stop at
 * the consumer cursor, so sparse reads visit changes rather than all history.
 * This is derived publication state; consumers never remove each other's rows. */
export class LatestChangeIndex<T extends { revision: number }> {
  private readonly entries = new Map<number, Entry<T>>();
  private oldest?: number;
  private newest?: number;
  floor = 0;
  readonly diagnostics = { reads: 0 };
  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Invalid change index capacity");
  }
  get(id: number): T | undefined {
    return this.entries.get(id)?.value;
  }
  private unlink(id: number, entry: Entry<T>): void {
    if (entry.previous === undefined) this.oldest = entry.next;
    else this.entries.get(entry.previous)!.next = entry.next;
    if (entry.next === undefined) this.newest = entry.previous;
    else this.entries.get(entry.next)!.previous = entry.previous;
    this.entries.delete(id);
  }
  set(id: number, value: T): void {
    const previous = this.entries.get(id);
    if (previous) this.unlink(id, previous);
    const entry: Entry<T> = { value, previous: this.newest };
    if (this.newest === undefined) this.oldest = id;
    else this.entries.get(this.newest)!.next = id;
    this.entries.set(id, entry);
    this.newest = id;
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.get(this.oldest!)!;
      this.floor = oldest.value.revision;
      this.unlink(this.oldest!, oldest);
    }
  }
  since(cursor: number): { id: number; value: T }[] {
    this.diagnostics.reads = 0;
    const rows: { id: number; value: T }[] = [];
    let id = this.newest;
    while (id !== undefined) {
      const entry = this.entries.get(id)!;
      if (entry.value.revision <= cursor) break;
      this.diagnostics.reads++;
      rows.push({ id, value: entry.value });
      id = entry.previous;
    }
    return rows.reverse();
  }
  clear(floor: number): void {
    this.entries.clear();
    this.oldest = this.newest = undefined;
    this.floor = floor;
    this.diagnostics.reads = 0;
  }
  get size(): number {
    return this.entries.size;
  }
}
