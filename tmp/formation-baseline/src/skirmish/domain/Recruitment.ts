import { EntityCollection } from "../EntityCollection";
import type { Building } from "../Protocol";
import type { RecruitmentJob } from "./Definitions";

export const RECRUITMENT_SECONDS = Object.freeze({
  infantry: 5,
  archer: 7,
  cavalry: 10,
  siege: 20,
  vehicle: 30,
  aircraft: 30,
  transport: 10,
  warship: 20,
});
type Job = Readonly<Omit<RecruitmentJob, "cost">> & {
  readonly cost: Readonly<RecruitmentJob["cost"]> & {
    readonly items?: Readonly<NonNullable<RecruitmentJob["cost"]["items"]>>;
  };
};
const EMPTY: readonly Job[] = Object.freeze([]);
interface Membership {
  playerId: number;
  buildingId: number;
  ordinal: number;
}
interface Bucket {
  rows: Job[];
  view?: readonly Job[];
}

/** Paid jobs retain canonical queue order. Membership changes maintain local
 * producer/player views; countdowns never rebuild those views. */
export class Recruitment {
  private readonly owners = new Map<number, Bucket>();
  private readonly producers = new Map<number, Bucket>();
  private readonly membership = new Map<number, Membership>();
  private ordinal = 0;
  private nextId = 1;
  private readonly entities = new EntityCollection<Job>({
    added: (job) => this.index(job),
    changed: (job) => this.changed(job),
    removed: (id) => this.unindex(id),
    restored: (jobs) => {
      this.owners.clear();
      this.producers.clear();
      this.membership.clear();
      this.ordinal = 0;
      for (const job of jobs) this.index(job);
    },
  });
  private readonly listeners = new Set<(job: Job, added: boolean) => void>();
  get jobs(): readonly Job[] {
    return this.entities.values;
  }
  byOwner(playerId: number): readonly Job[] {
    return this.view(this.owners.get(playerId));
  }
  byProducer(buildingId: number): readonly Job[] {
    return this.view(this.producers.get(buildingId));
  }
  byId(id: number): Job | undefined {
    return this.entities.get(id);
  }
  private view(bucket?: Bucket): readonly Job[] {
    return bucket
      ? (bucket.view ??= Object.freeze(bucket.rows.slice()))
      : EMPTY;
  }
  private insert(groups: Map<number, Bucket>, key: number, job: Job): void {
    let bucket = groups.get(key);
    if (!bucket) groups.set(key, (bucket = { rows: [] }));
    const ordinal = this.membership.get(job.id)!.ordinal;
    let low = 0,
      high = bucket.rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.membership.get(bucket.rows[middle].id)!.ordinal < ordinal)
        low = middle + 1;
      else high = middle;
    }
    bucket.rows.splice(low, 0, job);
    bucket.view = undefined;
  }
  private erase(groups: Map<number, Bucket>, key: number, id: number): void {
    const bucket = groups.get(key)!;
    bucket.rows.splice(
      bucket.rows.findIndex((job) => job.id === id),
      1,
    );
    bucket.view = undefined;
    if (!bucket.rows.length) groups.delete(key);
  }
  private index(job: Job): void {
    this.membership.set(job.id, {
      playerId: job.playerId,
      buildingId: job.buildingId,
      ordinal: this.ordinal++,
    });
    this.insert(this.owners, job.playerId, job);
    this.insert(this.producers, job.buildingId, job);
  }
  private changed(job: Job): void {
    const old = this.membership.get(job.id)!;
    if (old.playerId !== job.playerId) {
      this.erase(this.owners, old.playerId, job.id);
      old.playerId = job.playerId;
      this.insert(this.owners, job.playerId, job);
    }
    if (old.buildingId !== job.buildingId) {
      this.erase(this.producers, old.buildingId, job.id);
      old.buildingId = job.buildingId;
      this.insert(this.producers, job.buildingId, job);
    }
  }
  private unindex(id: number): void {
    const old = this.membership.get(id)!;
    this.erase(this.owners, old.playerId, id);
    this.erase(this.producers, old.buildingId, id);
    this.membership.delete(id);
  }
  updateJob(
    id: number,
    changes: Partial<Omit<RecruitmentJob, "id">>,
  ): Job | undefined {
    const before = this.byId(id);
    const membershipChanged =
      before &&
      (
        ["playerId", "buildingId", "category", "kind", "definitionId"] as const
      ).some((key) => key in changes && before[key] !== changes[key]);
    const previous = membershipChanged ? structuredClone(before) : undefined;
    const job = this.entities.update(id, changes);
    if (previous && job)
      for (const listener of this.listeners) {
        listener(previous, false);
        listener(job, true);
      }
    return job;
  }
  onChange(listener: (job: Job, added: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  checkpoint() {
    return structuredClone({ jobs: this.jobs, nextId: this.nextId });
  }
  restore(saved: ReturnType<Recruitment["checkpoint"]>): void {
    const state = structuredClone(saved);
    const previous = this.jobs;
    this.entities.restoreOwned(state.jobs);
    this.nextId = state.nextId;
    for (const listener of this.listeners) {
      for (const job of previous) listener(job, false);
      for (const job of this.jobs) listener(job, true);
    }
  }
  count(
    playerId: number,
    category: RecruitmentJob["category"],
    buildingId?: number,
  ): number {
    const jobs =
      buildingId === undefined
        ? this.byOwner(playerId)
        : this.byProducer(buildingId);
    let count = 0;
    for (const job of jobs)
      if (job.playerId === playerId && job.category === category) count++;
    return count;
  }
  chooseProducer(
    candidates: readonly Building[],
    distance: (tile: number) => number,
  ): Building | undefined {
    let best: Building | undefined,
      bestWork = Infinity,
      bestDistance = Infinity;
    for (const candidate of candidates) {
      let work = 0;
      for (const job of this.byProducer(candidate.id))
        work += job.remainingTicks;
      const d = distance(candidate.tile);
      if (
        !best ||
        work < bestWork ||
        (work === bestWork &&
          (d < bestDistance || (d === bestDistance && candidate.id < best.id)))
      ) {
        best = candidate;
        bestWork = work;
        bestDistance = d;
      }
    }
    return best;
  }
  enqueue(job: Omit<RecruitmentJob, "id" | "remainingTicks">): void {
    const paid = this.entities.add({
      ...job,
      id: this.nextId,
      remainingTicks: job.totalTicks,
    });
    this.nextId++;
    for (const listener of this.listeners) listener(paid, true);
  }
  private remove(job: Job): void {
    this.entities.remove(job.id);
    for (const listener of this.listeners) listener(job, false);
  }
  /** Cancel exactly one paid job, preferring the last waiting job over a head. */
  cancel(
    playerId: number,
    filter: {
      category?: RecruitmentJob["category"];
      definitionId?: string;
      kind?: string;
      buildingIds?: ReadonlySet<number>;
    },
    refund: (job: Job) => void,
  ): Job | undefined {
    let inactive: Job | undefined, active: Job | undefined;
    for (const job of this.byOwner(playerId)) {
      if (
        (filter.category !== undefined && job.category !== filter.category) ||
        (filter.definitionId !== undefined &&
          job.definitionId !== filter.definitionId) ||
        (filter.kind !== undefined && job.kind !== filter.kind) ||
        (filter.buildingIds && !filter.buildingIds.has(job.buildingId))
      )
        continue;
      const head = this.byProducer(job.buildingId)[0] === job;
      if (!head) inactive = job;
      else if (
        !active ||
        job.remainingTicks > active.remainingTicks ||
        (job.remainingTicks === active.remainingTicks && job.id > active.id)
      )
        active = job;
    }
    const job = inactive ?? active;
    if (!job) return undefined;
    this.entities.remove(job.id);
    refund(job);
    for (const listener of this.listeners) listener(job, false);
    return job;
  }
  step(
    buildings: readonly Building[],
    owners: Uint8Array,
    complete: (job: Job) => boolean,
    refund: (job: Job) => void,
    lookup?: (id: number) => Building | undefined,
  ): void {
    const producers =
      lookup ??
      (() => {
        const rows = new Map(buildings.map((b) => [b.id, b]));
        return (id: number) => rows.get(id);
      })();
    const busy = new Set<number>();
    for (const job of this.jobs) {
      const producer = producers(job.buildingId);
      if (
        !producer ||
        producer.playerId !== job.playerId ||
        owners[producer.tile] !== job.playerId ||
        (producer.health ?? 1) <= 0
      ) {
        refund(job);
        this.remove(job);
        continue;
      }
      if (!busy.has(job.buildingId) && !producer.remainingTicks) {
        busy.add(job.buildingId);
        this.entities.updateOwned(job.id, {
          remainingTicks: Math.max(0, job.remainingTicks - 1),
        });
        if (!job.remainingTicks && complete(job)) this.remove(job);
      }
    }
  }
}
