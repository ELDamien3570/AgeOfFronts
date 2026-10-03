import type { Ship, Squad } from "./Protocol";

type Unit = Squad | Ship;
interface Facts {
  owner: number;
  kind: string;
  definition: string | undefined;
  alive: boolean;
  carrier: number | null;
  ordinal: number;
}
class Bucket<T extends Unit> {
  readonly rows: T[] = [];
  private view?: readonly T[];
  constructor(private readonly ordinal: (record: T) => number) {}
  get values(): readonly T[] {
    return (this.view ??= Object.freeze(this.rows.slice()));
  }
  add(record: T): void {
    const order = this.ordinal(record);
    let low = 0,
      high = this.rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.ordinal(this.rows[middle]) < order) low = middle + 1;
      else high = middle;
    }
    this.rows.splice(low, 0, record);
    this.view = undefined;
  }
  remove(id: number): void {
    const at = this.rows.findIndex((record) => record.id === id);
    if (at < 0) throw new Error("Missing unit bucket identity");
    this.rows.splice(at, 1);
    this.view = undefined;
  }
}
export type UnitQueries<T extends Unit> = Readonly<
  Pick<
    UnitIndex<T>,
    | "byId"
    | "byOwner"
    | "byKind"
    | "byDefinition"
    | "aliveByOwner"
    | "cargo"
    | "membershipRevision"
    | "cargoRevision"
    | "dynamicRevision"
    | "diagnostics"
  >
>;

/** Exact derived membership and cargo facts. Mutation belongs to the entity
 * collection; ordinals preserve canonical source order after owner changes. */
export class UnitIndex<T extends Unit> {
  private readonly records = new Map<number, T>();
  private readonly facts = new Map<number, Facts>();
  private readonly owners = new Map<number, Bucket<T>>();
  private readonly kinds = new Map<string, Bucket<T>>();
  private readonly definitions = new Map<string, Bucket<T>>();
  private readonly active = new Map<number, Bucket<T>>();
  private readonly carriers = new Map<number, Bucket<T>>();
  private readonly empty: readonly T[] = Object.freeze([]);
  private ordinal = 0;
  private readonly order = (record: T) => this.facts.get(record.id)!.ordinal;
  private readonly counters = {
    rebuilds: 0,
    scannedRows: 0,
    incrementalUpdates: 0,
    queries: 0,
    comparisonRows: 0,
  };
  membershipRevision = 0;
  cargoRevision = 0;
  dynamicRevision = 0;
  get diagnostics() {
    return {
      ...this.counters,
      indexedRows: this.records.size,
      groups:
        this.owners.size +
        this.kinds.size +
        this.definitions.size +
        this.active.size +
        this.carriers.size,
    };
  }
  private describe(record: T, ordinal: number): Facts {
    return {
      owner: record.playerId,
      kind: record.kind,
      definition: record.definitionId,
      alive: "troops" in record ? record.troops > 0 : record.health > 0,
      carrier: "embarkedOn" in record ? record.embarkedOn : null,
      ordinal,
    };
  }
  private key(owner: number, value: string | undefined): string {
    return JSON.stringify([owner, value ?? null]);
  }
  private bind<K>(map: Map<K, Bucket<T>>, key: K, record: T): void {
    let bucket = map.get(key);
    if (!bucket) map.set(key, (bucket = new Bucket(this.order)));
    bucket.add(record);
  }
  private unbind<K>(map: Map<K, Bucket<T>>, key: K, id: number): void {
    const bucket = map.get(key);
    if (!bucket) throw new Error("Missing unit group");
    bucket.remove(id);
    if (!bucket.rows.length) map.delete(key);
  }
  private bindMembership(record: T, facts: Facts): void {
    this.bind(this.owners, facts.owner, record);
    this.bind(this.kinds, this.key(facts.owner, facts.kind), record);
    this.bind(
      this.definitions,
      this.key(facts.owner, facts.definition),
      record,
    );
    if (facts.alive) this.bind(this.active, facts.owner, record);
  }
  private unbindMembership(id: number, facts: Facts): void {
    this.unbind(this.owners, facts.owner, id);
    this.unbind(this.kinds, this.key(facts.owner, facts.kind), id);
    this.unbind(this.definitions, this.key(facts.owner, facts.definition), id);
    if (facts.alive) this.unbind(this.active, facts.owner, id);
  }
  add(record: T): void {
    if (this.records.has(record.id)) throw new Error("Duplicate unit identity");
    const facts = this.describe(record, this.ordinal++);
    this.records.set(record.id, record);
    this.facts.set(record.id, facts);
    this.bindMembership(record, facts);
    if (facts.carrier !== null) this.bind(this.carriers, facts.carrier, record);
    this.membershipRevision++;
    this.cargoRevision++;
    this.dynamicRevision++;
    this.counters.incrementalUpdates++;
  }
  changed(record: T): void {
    const before = this.facts.get(record.id);
    if (!before || this.records.get(record.id) !== record)
      throw new Error("Unowned unit change");
    const after = this.describe(record, before.ordinal);
    if (
      before.owner !== after.owner ||
      before.kind !== after.kind ||
      before.definition !== after.definition ||
      before.alive !== after.alive
    ) {
      this.unbindMembership(record.id, before);
      this.facts.set(record.id, after);
      this.bindMembership(record, after);
      this.membershipRevision++;
    }
    if (before.carrier !== after.carrier) {
      if (before.carrier !== null)
        this.unbind(this.carriers, before.carrier, record.id);
      if (after.carrier !== null)
        this.bind(this.carriers, after.carrier, record);
      this.cargoRevision++;
    }
    this.facts.set(record.id, after);
    this.dynamicRevision++;
    this.counters.incrementalUpdates++;
  }
  remove(id: number): void {
    const facts = this.facts.get(id);
    if (!facts) throw new Error("Missing unit identity");
    this.unbindMembership(id, facts);
    if (facts.carrier !== null) this.unbind(this.carriers, facts.carrier, id);
    this.facts.delete(id);
    this.records.delete(id);
    this.membershipRevision++;
    this.cargoRevision++;
    this.dynamicRevision++;
    this.counters.incrementalUpdates++;
  }
  rebuild(records: readonly T[]): void {
    this.records.clear();
    this.facts.clear();
    this.owners.clear();
    this.kinds.clear();
    this.definitions.clear();
    this.active.clear();
    this.carriers.clear();
    this.ordinal = 0;
    this.counters.rebuilds++;
    this.counters.scannedRows += records.length;
    this.membershipRevision++;
    this.cargoRevision++;
    this.dynamicRevision++;
    for (const record of records) this.add(record);
  }
  byId(id: number): T | undefined {
    this.counters.queries++;
    return this.records.get(id);
  }
  byOwner(owner: number): readonly T[] {
    this.counters.queries++;
    return this.owners.get(owner)?.values ?? this.empty;
  }
  byKind(owner: number, kind: T["kind"]): readonly T[] {
    this.counters.queries++;
    return this.kinds.get(this.key(owner, kind))?.values ?? this.empty;
  }
  byDefinition(owner: number, definition: string | undefined): readonly T[] {
    this.counters.queries++;
    return (
      this.definitions.get(this.key(owner, definition))?.values ?? this.empty
    );
  }
  aliveByOwner(owner: number): readonly T[] {
    this.counters.queries++;
    return this.active.get(owner)?.values ?? this.empty;
  }
  cargo(carrier: number): readonly T[] {
    this.counters.queries++;
    return this.carriers.get(carrier)?.values ?? this.empty;
  }
  verify(records: readonly T[]): void {
    this.counters.comparisonRows += records.length;
    const fail = () => {
      throw new Error("Unit index diverged from canonical records");
    };
    if (
      records.length !== this.records.size ||
      records.length !== this.facts.size
    )
      fail();
    const seen = new Set<number>();
    for (const record of records) {
      const actual = this.facts.get(record.id);
      if (
        !actual ||
        seen.has(record.id) ||
        this.records.get(record.id) !== record
      )
        fail();
      seen.add(record.id);
      const expected = this.describe(record, actual!.ordinal);
      if (
        Object.keys(expected).some(
          (key) => actual![key as keyof Facts] !== expected[key as keyof Facts],
        )
      )
        fail();
    }
    const check = <K>(
      groups: Map<K, Bucket<T>>,
      key: (record: T) => K | null,
    ) => {
      const reference = new Map<K, T[]>();
      for (const record of records) {
        const group = key(record);
        if (group === null) continue;
        let rows = reference.get(group);
        if (!rows) reference.set(group, (rows = []));
        rows.push(record);
      }
      if (reference.size !== groups.size) fail();
      for (const [group, rows] of reference) {
        const indexed = groups.get(group)?.rows;
        if (
          !indexed ||
          rows.length !== indexed.length ||
          rows.some((record, i) => record !== indexed[i])
        )
          fail();
      }
    };
    check(this.owners, (record) => record.playerId);
    check(this.kinds, (record) => this.key(record.playerId, record.kind));
    check(this.definitions, (record) =>
      this.key(record.playerId, record.definitionId),
    );
    check(this.active, (record) =>
      this.describe(record, 0).alive ? record.playerId : null,
    );
    check(this.carriers, (record) =>
      "embarkedOn" in record ? record.embarkedOn : null,
    );
  }
}
