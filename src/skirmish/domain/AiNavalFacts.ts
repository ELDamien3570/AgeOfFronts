import type { GameMap } from "../../core/game/GameMap";
import type { WaterPaths } from "../Pathfinding";
import { FIXED, type Building, type Ship } from "../Protocol";
import type { WorldPoint } from "../SpatialGrid";
import type { RecruitmentJob } from "./Definitions";
import { NavalFactSequence } from "./NavalFactSequence";
import type { Recruitment } from "./Recruitment";

export interface NavalFactWorld {
  map: GameMap;
  owners: Uint8Array;
  waterPaths: WaterPaths;
  buildings: readonly Building[];
  ships: readonly Ship[];
  recruitment: Recruitment;
  building(id: number): Building | undefined;
  ship(id: number): Ship | undefined;
}
interface Fact<T> {
  id: number;
  owner: number;
  sea: number;
  seen: number;
  sector?: string;
  ref?: T;
}
interface Theater {
  buildings: Set<number>;
  ships: Set<number>;
  jobs: Set<number>;
}
type RegistryValues = {buildings:Building;ships:Ship;jobs:RecruitmentJob};
type Registry = keyof RegistryValues;

/** One shared, resumable entity pass, plus O(1) authoritative mutation hooks.
 * Ports use the SAME first navigable neighbour as normal ship production.
 * No faction scans the map or other factions' production queues to pick a sea.
 * These are read facts; payment and movement remain in their domain handlers. */
export class AiNavalFacts {
  private readonly buildings = new Map<number, Fact<Building>>();
  private readonly ships = new Map<number, Fact<Ship>>();
  private readonly jobs = new Map<number, Fact<RecruitmentJob>>();
  private readonly owners = new Map<number, Map<number, Theater>>();
  private readonly sectors = new Map<string, Set<number>>();
  private readonly sequences = new Map<string, NavalFactSequence>();
  private phase = 0;
  private cursor = 0;
  private remaining = 0;
  private epoch = 0;
  private active = false;
  private nextScan = 0;
  ready = false;
  readonly diagnostics = { work: 0, passes: 0 };
  constructor(private readonly world: NavalFactWorld) {
    world.recruitment.onChange((job, added) => {
      if (job.category !== "ship") return;
      if (added) this.observeJob(job);
      else this.remove("jobs", job.id);
    });
  }
  checkpoint() {
    const saved = <T>(facts: Map<number, Fact<T>>) =>
      [...facts.values()].map(({ ref: _ref, ...fact }) => fact);
    return {
      buildings: saved(this.buildings),
      ships: saved(this.ships),
      jobs: saved(this.jobs),
      groups: structuredClone(this.owners),
      sectors: structuredClone(this.sectors),
      sequences: [...this.sequences].map(
        ([key, sequence]) => [key, sequence.checkpoint()] as const,
      ),
      phase: this.phase,
      cursor: this.cursor,
      remaining: this.remaining,
      epoch: this.epoch,
      active: this.active,
      nextScan: this.nextScan,
      ready: this.ready,
      passes: this.diagnostics.passes,
    };
  }
  restore(saved: ReturnType<AiNavalFacts["checkpoint"]>): void {
    this.buildings.clear();
    this.ships.clear();
    this.jobs.clear();
    this.owners.clear();
    this.sectors.clear();
    this.sequences.clear();
    const buildings = new Map(this.world.buildings.map((b) => [b.id, b])),
      ships = new Map(this.world.ships.map((s) => [s.id, s])),
      jobs = new Map(this.world.recruitment.jobs.map((j) => [j.id, j]));
    for (const fact of saved.buildings)
      this.put("buildings", { ...fact, ref: buildings.get(fact.id) });
    for (const fact of saved.ships)
      this.put("ships", { ...fact, ref: ships.get(fact.id) });
    for (const fact of saved.jobs)
      this.put("jobs", { ...fact, ref: jobs.get(fact.id) });
    // Group insertion order is a planning cursor input. Preserve it rather
    // than deriving a different candidate order from a cold cleanup cursor.
    this.owners.clear();
    for (const [owner, seas] of structuredClone(saved.groups))
      this.owners.set(owner, seas);
    this.sectors.clear();
    for (const [sector, ids] of structuredClone(saved.sectors))
      this.sectors.set(sector, ids);
    const derivedSequences = new Map(this.sequences);
    this.sequences.clear();
    for (const [key, state] of saved.sequences ?? []) {
      const sequence = new NavalFactSequence();
      sequence.restore(state);
      this.sequences.set(key, sequence);
    }
    // Preserve checkpoint key order after capture/reinsertion changed registry
    // order. Older checkpoints derive only the newly introduced owner index.
    for (const [key, sequence] of derivedSequences)
      if (!this.sequences.has(key)) this.sequences.set(key, sequence);
    this.phase = saved.phase;
    this.cursor = saved.cursor;
    this.remaining = saved.remaining;
    this.epoch = saved.epoch;
    this.active = saved.active;
    this.nextScan = saved.nextScan;
    this.ready = saved.ready;
    this.diagnostics.passes = saved.passes;
    this.diagnostics.work = 0;
  }
  private group(owner: number, sea: number): Theater {
    let seas = this.owners.get(owner);
    if (!seas) this.owners.set(owner, (seas = new Map()));
    let group = seas.get(sea);
    if (!group)
      seas.set(
        sea,
        (group = { buildings: new Set(), ships: new Set(), jobs: new Set() }),
      );
    return group;
  }
  private remove(kind: Registry, id: number, preserveSequence = false): void {
    const registry = this[kind] as Map<number, Fact<unknown>>,
      previous = registry.get(id);
    if (!previous) return;
    if (kind === "buildings")
      this.sequences.get(`owner-buildings:${previous.owner}`)?.remove(id);
    if (!preserveSequence)
      this.sequences.get(`${kind}:${previous.sea}`)?.remove(id);
    const seas = this.owners.get(previous.owner),
      group = seas?.get(previous.sea);
    group?.[kind].delete(id);
    if (
      group &&
      !group.buildings.size &&
      !group.ships.size &&
      !group.jobs.size
    ) {
      seas!.delete(previous.sea);
      if (!seas!.size) this.owners.delete(previous.owner);
    }
    if (previous.sector) {
      const sector = this.sectors.get(previous.sector);
      sector?.delete(id);
      if (!sector?.size) this.sectors.delete(previous.sector);
    }
    registry.delete(id);
  }
  private put(kind: Registry, fact: Fact<unknown>): void {
    const registry = this[kind] as Map<number, Fact<unknown>>,
      previous = registry.get(fact.id);
    if (
      previous &&
      (previous.owner !== fact.owner ||
        previous.sea !== fact.sea ||
        previous.sector !== fact.sector)
    )
      this.remove(kind, fact.id, previous.sea === fact.sea);
    registry.set(fact.id, fact);
    const key = `${kind}:${fact.sea}`;
    let sequence = this.sequences.get(key);
    if (!sequence)
      this.sequences.set(key, (sequence = new NavalFactSequence()));
    sequence.add(fact.id);
    if (kind === "buildings") {
      const ownerKey = `owner-buildings:${fact.owner}`;
      let owned = this.sequences.get(ownerKey);
      if (!owned)
        this.sequences.set(ownerKey, (owned = new NavalFactSequence()));
      owned.add(fact.id);
    }
    this.group(fact.owner, fact.sea)[kind].add(fact.id);
    if (fact.sector) {
      let sector = this.sectors.get(fact.sector);
      if (!sector) this.sectors.set(fact.sector, (sector = new Set()));
      sector.add(fact.id);
    }
  }
  private portSea(building: Building): number {
    const tile = this.world.map
      .neighbors(building.tile)
      .find((t) => this.world.waterPaths.walkable(t));
    return tile === undefined ? 0 : this.world.waterPaths.component[tile];
  }
  forgetBuilding(id: number): void { this.remove("buildings", id); }
  forgetShip(id: number): void { this.remove("ships", id); }
  observeBuilding(building: Building): void {
    const sea = this.portSea(building);
    if (!sea || (building.health ?? 1) <= 0) {
      this.remove("buildings", building.id);
      return;
    }
    this.put("buildings", {
      id: building.id,
      owner: building.playerId,
      sea,
      seen: this.epoch,
      ref: building,
    });
  }
  observeShip(ship: Ship): void {
    const x = Math.floor(ship.x / FIXED),
      y = Math.floor(ship.y / FIXED),
      tile = this.world.map.ref(x, y),
      sea = this.world.waterPaths.component[tile];
    if (!sea || ship.health <= 0 || ship.shoreTransfer) {
      this.remove("ships", ship.id);
      return;
    }
    const sector = `${sea}:${Math.floor(x / 16)}:${Math.floor(y / 16)}`;
    this.put("ships", {
      id: ship.id,
      owner: ship.playerId,
      sea,
      seen: this.epoch,
      sector,
      ref: ship,
    });
  }
  private observeJob(job: RecruitmentJob): void {
    if (job.category !== "ship") return;
    const producer = this.buildings.get(job.buildingId),
      sea = producer?.sea ?? 0;
    this.put("jobs", {
      id: job.id,
      owner: job.playerId,
      sea,
      seen: this.epoch,
      ref: job,
    });
  }
  step(tick: number, budget = 128): number {
    if (!Number.isInteger(budget) || budget < 0)
      throw new Error("Invalid naval fact budget");
    if (!this.active) {
      if (tick < this.nextScan || !budget) {
        this.diagnostics.work = 0;
        return 0;
      }
      this.active = true;
      this.epoch++;
      this.phase = 0;
      this.cursor = 0;
    }
    let used = 0;
    while (used < budget && this.active) {
      used++;
      if (this.phase < 3) {
        if (this.phase === 0) {
          const item = this.world.buildings[this.cursor++];
          if (item) {
            this.observeBuilding(item);
            continue;
          }
        } else if (this.phase === 1) {
          const item = this.world.ships[this.cursor++];
          if (item) {
            this.observeShip(item);
            continue;
          }
        } else {
          const item = this.world.recruitment.jobs[this.cursor++];
          if (item) {
            this.observeJob(item);
            continue;
          }
        }
        this.phase++;
        this.cursor = 0;
        if (this.phase === 3) this.remaining = this.buildings.size;
      } else {
        const kind: Registry =
            this.phase === 3
              ? "buildings"
              : this.phase === 4
                ? "ships"
                : "jobs",
          registry = this[kind] as Map<number, Fact<unknown>>;
        if (this.remaining) {
          const [id, fact] = registry.entries().next().value ?? [];
          this.remaining--;
          if (fact) {
            if (fact.seen < this.epoch) {
              // Array removals can move the scan cursor past a still-live
              // entity. Confirm identity in the authoritative O(1) lookup;
              // a missed scan is never evidence that a paid asset vanished.
              if (kind === "buildings") {
                const live = this.world.building(id!);
                if (live) this.observeBuilding(live);
                else this.remove(kind, id!);
              } else if (kind === "ships") {
                const live = this.world.ship(id!);
                if (live) this.observeShip(live);
                else this.remove(kind, id!);
              } else {
                const live = this.world.recruitment.byId(id!);
                if (live) this.observeJob(live);
                else this.remove(kind, id!);
              }
            }
            const current = registry.get(id!);
            if (current) {
              registry.delete(id!);
              registry.set(id!, current);
            }
          }
          continue;
        }
        this.phase++;
        if (this.phase === 6) {
          this.active = false;
          this.ready = true;
          this.nextScan = tick + 20;
          this.diagnostics.passes++;
        } else
          this.remaining = (this.phase === 4 ? this.ships : this.jobs).size;
      }
    }
    this.diagnostics.work = used;
    return used;
  }
  seas(owner: number): number[] {
    return [...(this.owners.get(owner)?.keys() ?? [])]
      .filter((s) => s > 0)
      .sort((a, b) => a - b);
  }
  firstSea(owner: number): number | undefined {
    const seas = this.owners.get(owner)?.keys();
    const first = seas?.next().value;
    return first === 0 ? seas?.next().value : first;
  }
  /** One charged record, including stale/missing cursor recovery. Consumers
   * persist next IDs, never serialize iterators or replay a prefix on resume. */
  readSea<K extends Registry>(kind: K, sea: number, cursor?: number | null) {
    const read = this.sequences.get(`${kind}:${sea}`)?.read(cursor) ?? {
      next: null,
      invalid: false,
    };
    return {
      ...read,
      value: (read.id === undefined ? undefined : this[kind].get(read.id)?.ref) as RegistryValues[K] | undefined,
    };
  }
  readOwnedBuilding(owner: number, cursor?: number | null) {
    const read = this.sequences
      .get(`owner-buildings:${owner}`)
      ?.read(cursor) ?? { next: null, invalid: false };
    return {
      ...read,
      value:
        read.id === undefined ? undefined : this.buildings.get(read.id)?.ref,
    };
  }
  *ports(owner: number, sea: number): Iterable<Building> {
    for (const id of this.owners.get(owner)?.get(sea)?.buildings ?? []) {
      const b = this.buildings.get(id)?.ref;
      if (
        b &&
        b.type === "port" &&
        b.playerId === owner &&
        this.world.owners[b.tile] === owner &&
        !b.remainingTicks &&
        (b.health ?? 1) > 0
      )
        yield b;
    }
  }
  *coastalBuildings(owner: number, sea: number): Iterable<Building> {
    for (const id of this.owners.get(owner)?.get(sea)?.buildings ?? []) {
      const b = this.buildings.get(id)?.ref;
      if (b && b.playerId === owner && (b.health ?? 1) > 0) yield b;
    }
  }
  *ownedShips(owner: number, sea: number): Iterable<Ship> {
    for (const id of this.owners.get(owner)?.get(sea)?.ships ?? []) {
      const ship = this.ships.get(id)?.ref;
      if (
        ship &&
        ship.playerId === owner &&
        ship.health > 0 &&
        !ship.shoreTransfer
      )
        yield ship;
    }
  }
  *paidShips(owner: number, sea: number): Iterable<RecruitmentJob> {
    for (const id of this.owners.get(owner)?.get(sea)?.jobs ?? []) {
      const job = this.jobs.get(id)?.ref,
        producer = job ? this.buildings.get(job.buildingId)?.ref : undefined;
      if (
        job &&
        producer &&
        producer.type === "port" &&
        producer.playerId === owner &&
        (producer.health ?? 1) > 0 &&
        this.world.owners[producer.tile] === owner
      )
        yield job;
    }
  }
  *nearbyShips(sea: number, point: WorldPoint, radius: number): Iterable<Ship> {
    const unit = 16 * FIXED;
    for (
      let sy = Math.max(0, Math.floor((point.y - radius) / unit));
      sy <= Math.floor((point.y + radius) / unit);
      sy++
    )
      for (
        let sx = Math.max(0, Math.floor((point.x - radius) / unit));
        sx <= Math.floor((point.x + radius) / unit);
        sx++
      )
        for (const id of this.sectors.get(`${sea}:${sx}:${sy}`) ?? []) {
          const ship = this.ships.get(id)?.ref;
          if (
            ship &&
            ship.health > 0 &&
            !ship.shoreTransfer &&
            (ship.x - point.x) ** 2 + (ship.y - point.y) ** 2 <= radius ** 2
          )
            yield ship;
        }
  }
}
