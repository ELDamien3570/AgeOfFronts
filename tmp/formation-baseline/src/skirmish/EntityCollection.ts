/** Canonical entity ownership. Consumers receive stable read-only records and
 * frozen collection views. All writes use this owner; indexes are derived hooks. */
export class EntityCollection<T extends { readonly id: number }> {
  private readonly records = new Map<number, T>();
  private view?: readonly T[];
  constructor(
    private readonly hooks: {
      added(record: T): void;
      changed(record: T): void;
      removed(id: number): void;
      restored(records: readonly T[]): void;
    },
  ) {}
  get values(): readonly T[] {
    return (this.view ??= Object.freeze([...this.records.values()]));
  }
  get(id: number): T | undefined {
    return this.records.get(id);
  }
  add(input: T): T {
    if (this.records.has(input.id))
      throw new Error("Duplicate entity identity");
    const record = structuredClone(input);
    this.records.set(record.id, record);
    this.view = undefined;
    this.hooks.added(record);
    return record;
  }
  update(id: number, changes: Partial<Omit<T, "id">>): T | undefined {
    return this.apply(id, changes, true);
  }
  /** Transfer finalized domain containers without another route-sized copy.
   * Callers must retain no writable alias; the collection itself stays private
   * to its owning aggregate. External mutation APIs always use update(). */
  updateOwned(id: number, changes: Partial<Omit<T, "id">>): T | undefined {
    return this.apply(id, changes, false);
  }
  /** Internal owned write: no patch object or enumeration for hot scalar fields. */
  setOwned<K extends Exclude<keyof T, "id">>(id: number, key: K, value: T[K]): T | undefined {
    if (key === "id" || key === "__proto__" || key === "prototype" || key === "constructor")
      throw new Error("Entity identity cannot change");
    const record = this.records.get(id);
    if (!record || Object.is(record[key], value)) return record;
    record[key] = value;
    this.hooks.changed(record);
    return record;
  }
  private apply(
    id: number,
    changes: Partial<Omit<T, "id">>,
    copy: boolean,
  ): T | undefined {
    let changed = false, containers = false;
    for (const key in changes) if (Object.prototype.hasOwnProperty.call(changes, key)) {
      if (key === "id" || key === "__proto__" || key === "prototype" || key === "constructor")
        throw new Error("Entity identity cannot change");
      const value = changes[key as keyof typeof changes];
      // Preserve structuredClone's rejection of unsupported external values.
      containers ||= value !== null && (typeof value === "object" || typeof value === "function" || typeof value === "symbol");
    }
    const record = this.records.get(id);
    if (!record) return undefined;
    for (const key in changes) if (Object.prototype.hasOwnProperty.call(changes, key) && !Object.is(record[key as keyof T], changes[key as keyof typeof changes])) { changed = true; break; }
    if (!changed) return record;
    Object.assign(record, copy && containers ? structuredClone(changes) : changes);
    this.hooks.changed(record);
    return record;
  }
  remove(id: number): boolean {
    if (!this.records.delete(id)) return false;
    this.view = undefined;
    this.hooks.removed(id);
    return true;
  }
  restore(inputs: readonly T[]): void {
    this.restoreInputs(inputs, true);
  }
  /** Adopt rows from an aggregate's already cloned checkpoint. */
  restoreOwned(inputs: readonly T[]): void {
    this.restoreInputs(inputs, false);
  }
  private restoreInputs(inputs: readonly T[], copy: boolean): void {
    const records = copy ? structuredClone(inputs) : inputs,
      ids = new Set<number>();
    for (const record of records) {
      if (ids.has(record.id)) throw new Error("Duplicate entity identity");
      ids.add(record.id);
    }
    this.records.clear();
    for (const record of records) this.records.set(record.id, record);
    this.view = undefined;
    this.hooks.restored(this.values);
  }
}
