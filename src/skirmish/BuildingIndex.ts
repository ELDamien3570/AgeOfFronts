import type { GameMap } from "../core/game/GameMap";
import type { Building } from "./Protocol";
import { BUILDING_RULES } from "./Rules";
const EMPTY_BUILDINGS: readonly Building[] = Object.freeze([]);
export type BuildingQueries = Readonly<
  Pick<
    BuildingIndex,
    | "at"
    | "nearby"
    | "towersNearby"
    | "countOfType"
    | "highestId"
    | "byId"
    | "byOwner"
    | "byType"
    | "production"
    | "diagnostics"
    | "geometryRevision"
    | "producerRevision"
    | "dynamicRevision"
  >
>;

class Bucket {
  readonly members: Building[] = [];
  private view?: readonly Building[];
  constructor(private readonly ordinal: (building: Building) => number) {}
  get values(): readonly Building[] {
    return (this.view ??= Object.freeze(this.members.slice()));
  }
  add(building: Building): void {
    const ordinal = this.ordinal(building);
    let low = 0,
      high = this.members.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.ordinal(this.members[middle]) < ordinal) low = middle + 1;
      else high = middle;
    }
    this.members.splice(low, 0, building);
    this.view = undefined;
  }
  remove(id: number): void {
    const at = this.members.findIndex((building) => building.id === id);
    if (at < 0) throw new Error("Missing building bucket identity");
    this.members.splice(at, 1);
    this.view = undefined;
  }
}
interface Facts {
  owner: number;
  type: Building["type"];
  tile: number;
  ordinal: number;
  ready: boolean;
  alive: boolean;
  age: Building["age"];
}
/** Derived lifecycle facts. One simulation owns the records; these structures
 * observe its explicit mutations and never choose authoritative writes. */
export class BuildingIndex {
  private readonly tiles = new Map<number, Bucket>();
  private readonly ids = new Map<number, Building>();
  private readonly facts = new Map<number, Facts>();
  private readonly towerSectors = new Map<number, Bucket>();
  private readonly representatives = new Map<
    number,
    Map<Building["type"], Building>
  >();
  private readonly owners = new Map<number, Bucket>();
  private readonly ownerTypes = new Map<
    number,
    Map<Building["type"], Bucket>
  >();
  private readonly income = new Map<
    number,
    { reserves: number; gold: number }
  >();
  private readonly heap: number[] = [];
  private readonly heapPositions = new Map<number, number>();
  private ordinal = 0;
  private readonly order = (building: Building) =>
    this.facts.get(building.id)!.ordinal;
  private readonly counters = {
    rebuilds: 0,
    scannedRows: 0,
    incrementalUpdates: 0,
    ownerQueries: 0,
    localGeometryRows: 0,
    comparisonRows: 0,
  };
  geometryRevision = 0;
  producerRevision = 0;
  dynamicRevision = 0;
  get highestId(): number {
    return this.heap[0] ?? 0;
  }
  get diagnostics() {
    return { ...this.counters, indexedRows: this.ids.size };
  }
  constructor(private readonly map: GameMap) {}
  rebuild(buildings: readonly Building[]): void {
    this.tiles.clear();
    this.ids.clear();
    this.facts.clear();
    this.towerSectors.clear();
    this.representatives.clear();
    this.owners.clear();
    this.ownerTypes.clear();
    this.income.clear();
    this.heap.length = 0;
    this.heapPositions.clear();
    this.ordinal = 0;
    this.counters.rebuilds++;
    this.counters.scannedRows += buildings.length;
    // A restore invalidates old derived consumers even when cardinality matches.
    this.geometryRevision++;
    this.producerRevision++;
    this.dynamicRevision++;
    for (const building of buildings) this.add(building);
  }
  private bucket<K>(map: Map<K, Bucket>, key: K): Bucket {
    let bucket = map.get(key);
    if (!bucket) map.set(key, (bucket = new Bucket(this.order)));
    return bucket;
  }
  private unbucket<K>(map: Map<K, Bucket>, key: K, id: number): void {
    const bucket = map.get(key);
    if (!bucket) throw new Error("Missing building bucket");
    bucket.remove(id);
    if (!bucket.members.length) map.delete(key);
  }
  private bindOwner(building: Building, facts: Facts): void {
    this.bucket(this.owners, facts.owner).add(building);
    let types = this.ownerTypes.get(facts.owner);
    if (!types) this.ownerTypes.set(facts.owner, (types = new Map()));
    this.bucket(types, facts.type).add(building);
  }
  private unbindOwner(id: number, facts: Facts): void {
    this.unbucket(this.owners, facts.owner, id);
    const types = this.ownerTypes.get(facts.owner)!;
    this.unbucket(types, facts.type, id);
    if (!types.size) this.ownerTypes.delete(facts.owner);
  }
  private bindGeometry(building: Building, facts: Facts): void {
    this.bucket(this.tiles, facts.tile).add(building);
    this.refreshRepresentatives(facts.tile);
    if (facts.type === "tower")
      this.bucket(
        this.towerSectors,
        this.towerSector(this.map.x(facts.tile), this.map.y(facts.tile)),
      ).add(building);
  }
  private unbindGeometry(id: number, facts: Facts): void {
    this.unbucket(this.tiles, facts.tile, id);
    this.refreshRepresentatives(facts.tile);
    if (facts.type === "tower")
      this.unbucket(
        this.towerSectors,
        this.towerSector(this.map.x(facts.tile), this.map.y(facts.tile)),
        id,
      );
  }
  private refreshRepresentatives(tile: number): void {
    const stack = this.tiles.get(tile)?.members;
    if (!stack) {
      this.representatives.delete(tile);
      return;
    }
    // Only the changed local stack is visited; legal stacks have at most ten rows.
    // Map insertion order matches a full rebuild even in mixed-type fixtures.
    const representatives = new Map<Building["type"], Building>();
    for (const building of stack) representatives.set(building.type, building);
    this.counters.localGeometryRows += stack.length;
    this.representatives.set(tile, representatives);
  }
  private changeIncome(facts: Facts, sign: 1 | -1): void {
    if (!facts.ready) return;
    let income = this.income.get(facts.owner);
    if (!income)
      this.income.set(facts.owner, (income = { reserves: 0, gold: 0 }));
    income.reserves += sign * BUILDING_RULES[facts.type].reserveIncome;
    income.gold += sign * BUILDING_RULES[facts.type].goldIncome;
    if (!income.reserves && !income.gold) this.income.delete(facts.owner);
  }
  add(building: Building): void {
    if (this.ids.has(building.id))
      throw new Error("Duplicate building identity");
    const facts: Facts = {
      owner: building.playerId,
      type: building.type,
      tile: building.tile,
      ordinal: this.ordinal++,
      ready: !building.remainingTicks && (building.health ?? 1) > 0,
      alive: (building.health ?? 1) > 0,
      age: building.age,
    };
    this.ids.set(building.id, building);
    this.facts.set(building.id, facts);
    this.bindOwner(building, facts);
    this.bindGeometry(building, facts);
    this.changeIncome(facts, 1);
    this.heapPositions.set(building.id, this.heap.length);
    this.heap.push(building.id);
    this.fixHeap(this.heap.length - 1);
    this.geometryRevision++;
    this.producerRevision++;
    this.dynamicRevision++;
    this.counters.incrementalUpdates++;
  }
  changed(building: Building): void {
    const facts = this.facts.get(building.id);
    if (!facts || this.ids.get(building.id) !== building)
      throw new Error("Missing building lifecycle identity");
    const geometry =
      facts.tile !== building.tile || facts.type !== building.type;
    const owner =
      facts.owner !== building.playerId || facts.type !== building.type;
    const ready = !building.remainingTicks && (building.health ?? 1) > 0;
    const alive = (building.health ?? 1) > 0;
    const aliveChanged = facts.alive !== alive;
    const production = owner || facts.ready !== ready;
    const tier = facts.age !== building.age;
    if (geometry) this.unbindGeometry(building.id, facts);
    if (owner) this.unbindOwner(building.id, facts);
    if (production) this.changeIncome(facts, -1);
    facts.owner = building.playerId;
    facts.type = building.type;
    facts.tile = building.tile;
    facts.ready = ready;
    facts.alive = alive;
    facts.age = building.age;
    if (geometry) this.bindGeometry(building, facts);
    if (owner) this.bindOwner(building, facts);
    if (production) this.changeIncome(facts, 1);
    if (geometry) this.geometryRevision++;
    if (production || aliveChanged || tier || geometry) this.producerRevision++;
    this.dynamicRevision++;
    this.counters.incrementalUpdates++;
  }
  remove(id: number): void {
    const facts = this.facts.get(id);
    if (!facts) throw new Error("Missing building lifecycle identity");
    this.unbindGeometry(id, facts);
    this.unbindOwner(id, facts);
    this.changeIncome(facts, -1);
    this.facts.delete(id);
    this.ids.delete(id);
    this.removeHeap(id);
    this.geometryRevision++;
    this.producerRevision++;
    this.dynamicRevision++;
    this.counters.incrementalUpdates++;
  }
  private swapHeap(a: number, b: number): void {
    [this.heap[a], this.heap[b]] = [this.heap[b], this.heap[a]];
    this.heapPositions.set(this.heap[a], a);
    this.heapPositions.set(this.heap[b], b);
  }
  private fixHeap(at: number): void {
    if (at > 0 && this.heap[at] > this.heap[(at - 1) >>> 1]) {
      while (at > 0) {
        const parent = (at - 1) >>> 1;
        if (this.heap[parent] >= this.heap[at]) break;
        this.swapHeap(parent, at);
        at = parent;
      }
    } else
      while (at * 2 + 1 < this.heap.length) {
        let child = at * 2 + 1;
        if (
          child + 1 < this.heap.length &&
          this.heap[child + 1] > this.heap[child]
        )
          child++;
        if (this.heap[at] >= this.heap[child]) break;
        this.swapHeap(child, at);
        at = child;
      }
  }
  private removeHeap(id: number): void {
    const at = this.heapPositions.get(id)!;
    const tail = this.heap.pop()!;
    this.heapPositions.delete(id);
    if (at === this.heap.length) return;
    this.heap[at] = tail;
    this.heapPositions.set(tail, at);
    this.fixHeap(at);
  }
  countOfType(playerId: number, type: Building["type"]): number {
    return this.ownerTypes.get(playerId)?.get(type)?.members.length ?? 0;
  }
  at(tile: number): readonly Building[] {
    return this.tiles.get(tile)?.values ?? EMPTY_BUILDINGS;
  }
  byId(id: number): Building | undefined {
    return this.ids.get(id);
  }
  byOwner(owner: number): readonly Building[] {
    this.counters.ownerQueries++;
    return this.owners.get(owner)?.values ?? EMPTY_BUILDINGS;
  }
  byType(owner: number, type: Building["type"]): readonly Building[] {
    this.counters.ownerQueries++;
    return this.ownerTypes.get(owner)?.get(type)?.values ?? EMPTY_BUILDINGS;
  }
  production(owner: number): Readonly<{ reserves: number; gold: number }> {
    return { ...(this.income.get(owner) ?? { reserves: 0, gold: 0 }) };
  }
  /** Development reference check, never an automatic cache-repair path. */
  verify(buildings: readonly Building[]): void {
    const mismatch = () => {
      throw new Error("Building lifecycle index mismatch");
    };
    if (
      this.ids.size !== buildings.length ||
      this.heap.length !== buildings.length ||
      this.heapPositions.size !== buildings.length
    )
      mismatch();
    this.counters.comparisonRows += buildings.length;
    let highest = 0;
    for (const building of buildings) {
      const facts = this.facts.get(building.id);
      highest = Math.max(highest, building.id);
      if (
        this.ids.get(building.id) !== building ||
        !facts ||
        facts.owner !== building.playerId ||
        facts.type !== building.type ||
        facts.tile !== building.tile ||
        facts.age !== building.age ||
        facts.ready !==
          (!building.remainingTicks && (building.health ?? 1) > 0) ||
        facts.alive !== (building.health ?? 1) > 0 ||
        this.heap[this.heapPositions.get(building.id)!] !== building.id
      )
        mismatch();
    }
    if (this.highestId !== highest) mismatch();
    const same = (actual: readonly Building[], expected: readonly Building[]) =>
      actual.length === expected.length &&
      actual.every((building, at) => building === expected[at]);
    for (const building of buildings) {
      if (
        !this.owners.get(building.playerId)?.members.includes(building) ||
        !this.ownerTypes
          .get(building.playerId)
          ?.get(building.type)
          ?.members.includes(building) ||
        !this.tiles.get(building.tile)?.members.includes(building)
      )
        mismatch();
    }
    for (const [owner, bucket] of this.owners) {
      const expected = buildings.filter(
        (building) => building.playerId === owner,
      );
      if (
        expected.length !== bucket.members.length ||
        expected.some((building, at) => bucket.members[at] !== building)
      )
        mismatch();
      const income = expected
        .filter(
          (building) => !building.remainingTicks && (building.health ?? 1) > 0,
        )
        .reduce(
          (sum, building) => ({
            reserves:
              sum.reserves + BUILDING_RULES[building.type].reserveIncome,
            gold: sum.gold + BUILDING_RULES[building.type].goldIncome,
          }),
          { reserves: 0, gold: 0 },
        );
      const indexedIncome = this.production(owner);
      if (
        income.reserves !== indexedIncome.reserves ||
        income.gold !== indexedIncome.gold
      )
        mismatch();
      for (const [type, typed] of this.ownerTypes.get(owner)!) {
        const expectedType = expected.filter(
          (building) => building.type === type,
        );
        if (
          expectedType.length !== typed.members.length ||
          expectedType.some((building, at) => typed.members[at] !== building)
        )
          mismatch();
      }
    }
    for (const [tile, bucket] of this.tiles) {
      const expected = buildings.filter((building) => building.tile === tile);
      if (!same(bucket.members, expected)) mismatch();
      const representatives = new Map<Building["type"], Building>();
      for (const building of expected)
        representatives.set(building.type, building);
      if (
        !same(
          [...(this.representatives.get(tile)?.values() ?? [])],
          [...representatives.values()],
        )
      )
        mismatch();
    }
    const towers = buildings.filter((building) => building.type === "tower");
    const sectors = new Set(
      towers.map((building) =>
        this.towerSector(this.map.x(building.tile), this.map.y(building.tile)),
      ),
    );
    if (
      sectors.size !== this.towerSectors.size ||
      this.tiles.size !== this.representatives.size
    )
      mismatch();
    for (const sector of sectors) {
      const expected = towers.filter(
        (building) =>
          this.towerSector(
            this.map.x(building.tile),
            this.map.y(building.tile),
          ) === sector,
      );
      if (
        !same(
          this.towerSectors.get(sector)?.members ?? EMPTY_BUILDINGS,
          expected,
        )
      )
        mismatch();
    }
  }
  private towerSector(x: number, y: number): number {
    return (
      Math.floor(y / 16) * Math.ceil(this.map.width() / 16) + Math.floor(x / 16)
    );
  }
  *towersNearby(tile: number, radius: number): Iterable<Building> {
    const x = this.map.x(tile),
      y = this.map.y(tile);
    for (
      let sy = Math.max(0, Math.floor((y - radius) / 16));
      sy <=
      Math.min(
        Math.ceil(this.map.height() / 16) - 1,
        Math.floor((y + radius) / 16),
      );
      sy++
    )
      for (
        let sx = Math.max(0, Math.floor((x - radius) / 16));
        sx <=
        Math.min(
          Math.ceil(this.map.width() / 16) - 1,
          Math.floor((x + radius) / 16),
        );
        sx++
      )
        for (const tower of this.towerSectors.get(
          this.towerSector(sx * 16, sy * 16),
        )?.values ?? EMPTY_BUILDINGS)
          if (this.map.euclideanDistSquared(tile, tower.tile) <= radius ** 2)
            yield tower;
  }
  /** Exact local stacks for callers needing every independent building. */
  *allNearby(tile: number, radius: number): Iterable<Building> {
    const x = this.map.x(tile),
      y = this.map.y(tile),
      extent = Math.ceil(radius);
    for (
      let yy = Math.max(0, y - extent);
      yy <= Math.min(this.map.height() - 1, y + extent);
      yy++
    )
      for (
        let xx = Math.max(0, x - extent);
        xx <= Math.min(this.map.width() - 1, x + extent);
        xx++
      )
        yield* this.tiles.get(this.map.ref(xx, yy))?.values ?? EMPTY_BUILDINGS;
  }
  *nearby(tile: number, radius: number): Iterable<Building> {
    const x = this.map.x(tile),
      y = this.map.y(tile),
      extent = Math.ceil(radius);
    for (
      let yy = Math.max(0, y - extent);
      yy <= Math.min(this.map.height() - 1, y + extent);
      yy++
    )
      for (
        let xx = Math.max(0, x - extent);
        xx <= Math.min(this.map.width() - 1, x + extent);
        xx++
      ) {
        const stack = this.representatives.get(this.map.ref(xx, yy));
        // Legal stacks contain only one type. Keep invalid fixture mixtures
        // detectable too, without checking every duplicate building.
        if (stack) yield* stack.values();
      }
  }
}
