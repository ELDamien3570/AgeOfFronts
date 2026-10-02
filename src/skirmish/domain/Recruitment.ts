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
export class Recruitment {
  readonly jobs: RecruitmentJob[] = [];
  private readonly ids = new Map<number, RecruitmentJob>();
  private nextId = 1;
  private readonly listeners = new Set<
    (job: RecruitmentJob, added: boolean) => void
  >();
  onChange(
    listener: (job: RecruitmentJob, added: boolean) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  checkpoint() {
    return structuredClone({ jobs: this.jobs, nextId: this.nextId });
  }
  restore(saved: ReturnType<Recruitment["checkpoint"]>): void {
    const state = structuredClone(saved);
    this.jobs.splice(0, this.jobs.length, ...state.jobs);
    this.ids.clear();
    for (const job of this.jobs) this.ids.set(job.id, job);
    this.nextId = state.nextId;
  }
  count(
    playerId: number,
    category: RecruitmentJob["category"],
    buildingId?: number,
  ): number {
    return this.jobs.filter(
      (j) =>
        j.playerId === playerId &&
        j.category === category &&
        (buildingId === undefined || j.buildingId === buildingId),
    ).length;
  }
  byId(id: number): RecruitmentJob | undefined {
    return this.ids.get(id);
  }
  chooseProducer(
    candidates: readonly Building[],
    distance: (tile: number) => number,
  ): Building | undefined {
    const workload = new Map<number, number>();
    for (const job of this.jobs)
      workload.set(
        job.buildingId,
        (workload.get(job.buildingId) ?? 0) + job.remainingTicks,
      );
    return [...candidates].sort(
      (a, b) =>
        (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0) ||
        distance(a.tile) - distance(b.tile) ||
        a.id - b.id,
    )[0];
  }
  enqueue(job: Omit<RecruitmentJob, "id" | "remainingTicks">): void {
    const paid: RecruitmentJob = {
      ...job,
      id: this.nextId++,
      remainingTicks: job.totalTicks,
    };
    this.jobs.push(paid);
    this.ids.set(paid.id, paid);
    for (const listener of this.listeners) listener(paid, true);
  }
  step(
    buildings: readonly Building[],
    owners: Uint8Array,
    complete: (job: RecruitmentJob) => boolean,
    refund: (job: RecruitmentJob) => void,
  ): void {
    const producers = new Map(buildings.map((b) => [b.id, b]));
    const busy = new Set<number>();
    for (let i = 0; i < this.jobs.length; ) {
      const job = this.jobs[i],
        producer = producers.get(job.buildingId);
      if (
        !producer ||
        producer.playerId !== job.playerId ||
        owners[producer.tile] !== job.playerId ||
        (producer.health ?? 1) <= 0
      ) {
        refund(job);
        this.jobs.splice(i, 1);
        this.ids.delete(job.id);
        for (const listener of this.listeners) listener(job, false);
        continue;
      }
      if (!busy.has(job.buildingId) && !producer.remainingTicks) {
        busy.add(job.buildingId);
        job.remainingTicks = Math.max(0, job.remainingTicks - 1);
        // Completed training waits for a safe spawn position without charging again.
        if (!job.remainingTicks && complete(job)) {
          this.jobs.splice(i, 1);
          this.ids.delete(job.id);
          for (const listener of this.listeners) listener(job, false);
          continue;
        }
      }
      i++;
    }
  }
}
