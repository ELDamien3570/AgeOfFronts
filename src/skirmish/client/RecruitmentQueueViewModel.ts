import { TICKS_PER_SECOND, type Snapshot } from "../Protocol";
import { UNIT, VESSEL } from "../content/Units";
import type { RecruitmentJob } from "../domain/Definitions";

export interface RecruitmentQueueEntry {
  key: string;
  definitionId?: string;
  kind: RecruitmentJob["kind"];
  name: string;
  count: number;
  progress: number;
  seconds: number | null;
}

// Aggregate authoritative jobs without hiding separate tiers or counting only
// one producer. Only each producer's FIFO head can make progress.
export class RecruitmentQueueViewModel {
  readonly entries: RecruitmentQueueEntry[] = [];
  constructor(snapshot: Pick<Snapshot, "expansion">, playerId = 1, buildingIds?: ReadonlySet<number>) {
    const jobs = (snapshot.expansion?.recruitment ?? []).filter(
      (j) => j.playerId === playerId && (!buildingIds?.size || buildingIds.has(j.buildingId)),
    );
    const heads = new Set<number>();
    const groups = new Map<
      string,
      { entry: RecruitmentQueueEntry; next?: RecruitmentJob }
    >();
    for (const job of jobs) {
      const active = !heads.has(job.buildingId);
      heads.add(job.buildingId);
      const key = `${job.category}:${job.definitionId ?? job.kind}`;
      let group = groups.get(key);
      if (!group) {
        const name =
          job.category === "aircraft"
            ? job.kind === "fighter"
              ? "Fighter"
              : "Bomber"
            : (UNIT.get(job.definitionId ?? "")?.name ??
              VESSEL.get(job.definitionId ?? "")?.name ??
              job.kind);
        group = {
          entry: {
            key,
            definitionId: job.definitionId,
            kind: job.kind,
            name,
            count: 0,
            progress: 0,
            seconds: null,
          },
        };
        groups.set(key, group);
      }
      group.entry.count++;
      if (
        active &&
        (!group.next || job.remainingTicks < group.next.remainingTicks)
      )
        group.next = job;
    }
    for (const { entry, next } of groups.values()) {
      if (next) {
        entry.progress = Math.max(
          0,
          Math.min(1, 1 - next.remainingTicks / next.totalTicks),
        );
        entry.seconds = Math.ceil(next.remainingTicks / TICKS_PER_SECOND);
      }
      this.entries.push(entry);
    }
  }
}
