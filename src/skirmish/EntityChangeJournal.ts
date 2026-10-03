/** Bounded latest entity changes. Every encoder has its own cursor. Removal
 * history is retained for remove/re-add ordering, even when the final ID exists. */
export class EntityChangeJournal {
  private readonly latest = new Map<
    number,
    { revision: number; added: number; removed: number }
  >();
  private floor = 0;
  revision = 0;
  constructor(readonly capacity = 32768) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Invalid entity journal capacity");
  }
  record(id: number, kind: "add" | "change" | "remove"): void {
    if (!Number.isSafeInteger(id)) throw new Error("Invalid entity identity");
    const previous = this.latest.get(id);
    const revision = ++this.revision;
    this.latest.delete(id);
    this.latest.set(id, {
      revision,
      added: kind === "add" ? revision : (previous?.added ?? 0),
      removed: kind === "remove" ? revision : (previous?.removed ?? 0),
    });
    if (this.latest.size > this.capacity) {
      const [oldest, change] = this.latest.entries().next().value!;
      this.floor = change.revision;
      this.latest.delete(oldest);
    }
  }
  since(
    cursor: number,
  ): { id: number; removed: boolean; added: number }[] | undefined {
    if (cursor < this.floor || cursor > this.revision) return undefined;
    const changes: { id: number; removed: boolean; added: number }[] = [];
    for (const [id, change] of this.latest)
      if (change.revision > cursor)
        changes.push({
          id,
          removed: change.removed > cursor,
          added: change.added,
        });
    return changes.sort((a, b) => a.added - b.added);
  }
  invalidate(): void {
    this.latest.clear();
    this.floor = ++this.revision;
  }
  get retainedIds(): number {
    return this.latest.size;
  }
}
