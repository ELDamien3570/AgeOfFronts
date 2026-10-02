/** Stable O(1) continuations for a maintained fact stream. Array offsets and
 * replaying Set iterators cannot bound a resumed controller's work. */
export class NavalFactSequence {
  private readonly nodes = new Map<
    number,
    { previous: number | null; next: number | null }
  >();
  private first: number | null = null;
  private last: number | null = null;
  add(id: number): void {
    if (this.nodes.has(id)) return;
    this.nodes.set(id, { previous: this.last, next: null });
    if (this.last !== null) this.nodes.get(this.last)!.next = id;
    else this.first = id;
    this.last = id;
  }
  remove(id: number): void {
    const node = this.nodes.get(id);
    if (!node) return;
    if (node.previous !== null) this.nodes.get(node.previous)!.next = node.next;
    else this.first = node.next;
    if (node.next !== null) this.nodes.get(node.next)!.previous = node.previous;
    else this.last = node.previous;
    this.nodes.delete(id);
  }
  read(cursor?: number | null): {
    id?: number;
    next: number | null;
    invalid: boolean;
  } {
    const id = cursor === undefined ? this.first : cursor;
    if (id === null) return { next: null, invalid: false };
    const node = this.nodes.get(id);
    return node
      ? { id, next: node.next, invalid: false }
      : { next: this.first, invalid: true };
  }
  checkpoint() {
    return structuredClone({
      nodes: this.nodes,
      first: this.first,
      last: this.last,
    });
  }
  restore(saved: ReturnType<NavalFactSequence["checkpoint"]>): void {
    this.nodes.clear();
    for (const [id, node] of structuredClone(saved.nodes))
      this.nodes.set(id, node);
    this.first = saved.first;
    this.last = saved.last;
  }
}
