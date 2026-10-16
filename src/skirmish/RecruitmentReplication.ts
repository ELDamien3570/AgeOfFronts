import type { RecruitmentJob } from "./domain/Definitions";

/** P13 wire form of the recruitment queue, grouped by faction. Only the first
 * job of each producer counts down (Recruitment.step); it carries the tick it
 * finishes instead of its countdown, and the jobs waiting behind it keep
 * their (unchanging) remainingTicks. So a faction's list changes only when a
 * job starts, finishes or stalls, and is sent only then. The decoder derives
 * `remainingTicks = endTick - packet.tick` for counting jobs and rebuilds the
 * queue in id order, which is the authoritative order (jobs are kept in
 * creation order and ids only grow). */
export type WireRecruitmentJob = Omit<RecruitmentJob, "remainingTicks"> &
  ({ endTick: number; remainingTicks?: undefined } | { remainingTicks: number; endTick?: undefined });
/** Faction id -> that faction's jobs. In a delta, an empty list removes the
 * faction's jobs and an absent faction is unchanged. */
export type RecruitmentWire = Record<number, WireRecruitmentJob[]>;
export type RecruitmentMode = "full" | "delta";

/** `jobs` in queue order; the first job of each producer counts down. A wrong
 * guess only costs a resend: a frozen job in endTick form changes every tick. */
export function toWireRecruitment(jobs: readonly RecruitmentJob[], tick: number): WireRecruitmentJob[] {
  const heads = new Set<number>();
  return jobs.map(({ remainingTicks, ...job }) => {
    const counting = !heads.has(job.buildingId) && remainingTicks > 0;
    heads.add(job.buildingId);
    return counting ? { ...job, endTick: tick + remainingTicks } : { ...job, remainingTicks };
  });
}
export function fromWireRecruitment(jobs: readonly WireRecruitmentJob[], tick: number): RecruitmentJob[] {
  return jobs.map(({ endTick, remainingTicks, ...job }) => ({ ...job, remainingTicks: endTick === undefined ? remainingTicks! : endTick - tick }));
}

/** Encoder-owned per-faction cursor. A faction's list is sent when its wire
 * form differs from the last one sent on this stream (compared as JSON, so
 * no missed revision can hide a change), and every list on a full packet. */
export class RecruitmentReplicationEncoder {
  private readonly sent = new Map<number, string>();
  encode(jobs: readonly RecruitmentJob[], tick: number, full: boolean): { mode: RecruitmentMode; changes?: RecruitmentWire } {
    if (full) this.sent.clear();
    const byFaction = new Map<number, RecruitmentJob[]>();
    for (const job of jobs) {
      let list = byFaction.get(job.playerId);
      if (!list) byFaction.set(job.playerId, list = []);
      list.push(job);
    }
    const changes: RecruitmentWire = {};
    let changed = false;
    for (const [playerId, list] of byFaction) {
      const wire = toWireRecruitment(list, tick), json = JSON.stringify(wire);
      if (!full && this.sent.get(playerId) === json) continue;
      this.sent.set(playerId, json);
      changes[playerId] = wire;
      changed = true;
    }
    for (const playerId of [...this.sent.keys()]) if (!byFaction.has(playerId)) {
      this.sent.delete(playerId);
      changes[playerId] = [];
      changed = true;
    }
    return { mode: full ? "full" : "delta", changes: full || changed ? changes : undefined };
  }
}

/** Decoder-owned last received lists, materialised for every packet tick. */
export class RecruitmentReplicationDecoder {
  private lists?: Map<number, WireRecruitmentJob[]>;
  clear(): void { this.lists = undefined; }
  validate(mode: unknown, changes: unknown, baseline: boolean): void {
    if (mode !== "full" && mode !== "delta") throw new Error("Invalid recruitment mode");
    if (mode === "delta" && !baseline && !this.lists) throw new Error("Recruitment delta has no baseline");
    if (changes === undefined) return;
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("Invalid recruitment changes");
    for (const [key, list] of Object.entries(changes)) {
      if (!Number.isSafeInteger(Number(key)) || !Array.isArray(list)) throw new Error("Invalid recruitment faction");
      for (const job of list as WireRecruitmentJob[])
        if (!job || typeof job !== "object" || job.playerId !== Number(key) || !Number.isSafeInteger(job.id) ||
          !Number.isSafeInteger(job.totalTicks) ||
          (job.endTick === undefined) === (job.remainingTicks === undefined) ||
          !Number.isSafeInteger(job.endTick ?? job.remainingTicks))
          throw new Error("Invalid recruitment job");
    }
  }
  apply(mode: RecruitmentMode, changes: RecruitmentWire | undefined, tick: number): RecruitmentJob[] {
    if (mode === "full" || !this.lists) this.lists = new Map();
    for (const [key, list] of Object.entries(changes ?? {})) {
      if (list.length) this.lists.set(Number(key), structuredClone(list));
      else this.lists.delete(Number(key));
    }
    const jobs: WireRecruitmentJob[] = [];
    for (const list of this.lists.values()) jobs.push(...list);
    jobs.sort((a, b) => a.id - b.id);
    return fromWireRecruitment(jobs, tick);
  }
}
