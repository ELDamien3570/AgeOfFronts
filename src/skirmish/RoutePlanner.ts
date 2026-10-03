import type { LandPaths, WaterPaths } from "./Pathfinding";
import { PlanningWorkspace, type PlanningPathState } from "./PlanningWorkspace";
import {
  PLANNER_CALLERS,
  type PlannerCaller,
  type PlannerCohort,
} from "./RuntimeDiagnostics";

export interface ExactRouteRequest<T> {
  key: string;
  start: number;
  goal: number;
  alternatives?: number[];
  prepare?: boolean;
  water: boolean;
  createdTick: number;
  obstacleRevision: string;
  context: T;
}
interface Job<T> extends ExactRouteRequest<T> {
  search: PlanningPathState;
  output: number[];
  copied: number;
  nextCandidate: number;
  uncertain: boolean;
  prepared: boolean;
  releasing?: ExactRouteOutcome;
  discard?: boolean;
  replacement?: ExactRouteRequest<T>;
  exclusiveRetry?: boolean;
  waitingForWorkspace?: boolean;
}
export type ExactRouteOutcome =
  | "complete"
  | "unreachable"
  | "limited"
  | "superseded";
export interface RoutePlannerPorts<T> {
  /** Domain attribution for fair scheduling and bounded cohort diagnostics. */
  identity?(request: ExactRouteRequest<T>): {
    playerId: number;
    caller: PlannerCaller;
  };
  prepare?(
    request: ExactRouteRequest<T>,
    budget: number,
    rayBudget: number,
  ): {
    work: number;
    rays?: number;
    goal?: number;
    alternatives?: number[];
    failed?: boolean;
  };
  valid(request: ExactRouteRequest<T>): boolean;
  obstacleRevision(request: ExactRouteRequest<T>): string;
  blocked(
    request: ExactRouteRequest<T>,
  ): ((tile: number) => boolean) | undefined;
  completed(
    request: ExactRouteRequest<T>,
    outcome: ExactRouteOutcome,
    path: number[],
  ): void;
}

/** Checkpointed, fair exact work shared by land and water callers. Search,
 * reconstruction and publication copies yield inside a job. Domain owners
 * validate its generation and revisions before atomically accepting a result.
 */
export class RoutePlanner<T> {
  private readonly jobs = new Map<string, Job<T>>();
  private readonly cohorts = new Map<string, PlannerCohort>();
  private readonly workspace: PlanningWorkspace;
  // Version 1 restores historical FIFO checkpoints without changing their outcomes.
  private schedulingVersion = 3;
  private exclusiveKey?: string;
  private lastPlayer = -1;
  private readonly lastCaller = new Map<number, number>();
  readonly diagnostics = {
    work: 0,
    pending: 0,
    oldestAge: 0,
    completed: 0,
    limited: 0,
    superseded: 0,
    admissionDeferred: 0,
    escalated: 0,
    workspaceBytes: 0,
    workspaceUsed: 0,
  };
  constructor(
    private readonly land: LandPaths,
    private readonly water: WaterPaths,
    private readonly ports: RoutePlannerPorts<T>,
    private readonly jobLimit = 128,
    workspaceCapacity = 65_536,
  ) {
    if (!Number.isInteger(jobLimit) || jobLimit < 1 || jobLimit > 128)
      throw new Error("Invalid route queue limit");
    this.workspace = new PlanningWorkspace(workspaceCapacity);
    this.diagnostics.workspaceBytes = this.workspace.bytes;
  }
  checkpoint() {
    return structuredClone({
      landRevision: this.land.revision,
      waterRevision: this.water.revision,
      jobs: [...this.jobs.values()],
      workspace: this.workspace.checkpoint(),
      scheduling: {
        version: this.schedulingVersion,
        lastPlayer: this.lastPlayer,
        lastCaller: [...this.lastCaller],
        exclusiveKey: this.exclusiveKey,
      },
    });
  }
  restore(
    saved: Omit<
      ReturnType<RoutePlanner<T>["checkpoint"]>,
      "workspace" | "scheduling"
    > & {
      scheduling?: ReturnType<RoutePlanner<T>["checkpoint"]>["scheduling"];
      workspace?: ReturnType<PlanningWorkspace["checkpoint"]>;
    },
  ): void {
    if (saved.jobs.length > this.jobLimit)
      throw new Error("Route checkpoint exceeds queue limit");
    if (!saved.workspace && saved.jobs.length)
      throw new Error("Missing route checkpoint workspace");
    const scheduling = saved.scheduling;
    if (
      scheduling &&
      (![1, 2, 3].includes(scheduling.version) ||
        !Number.isInteger(scheduling.lastPlayer) ||
        scheduling.lastPlayer < -1 ||
        scheduling.lastPlayer >= 256 ||
        scheduling.lastCaller.length > 256 ||
        new Set(scheduling.lastCaller.map(([player]) => player)).size !==
          scheduling.lastCaller.length ||
        scheduling.lastCaller.some(
          ([player, caller]) =>
            !Number.isInteger(player) ||
            player < 0 ||
            player >= 256 ||
            !Number.isInteger(caller) ||
            caller < 0 ||
            caller >= PLANNER_CALLERS.length,
        ) ||
        (scheduling.exclusiveKey !== undefined &&
          !saved.jobs.some(
            (job) => job.key === scheduling.exclusiveKey && job.exclusiveRetry,
          )))
    )
      throw new Error("Invalid planner scheduling checkpoint");
    this.land.restoreRevision(saved.landRevision);
    this.water.restoreRevision(saved.waterRevision);
    this.workspace.restore(
      saved.workspace ??
        new PlanningWorkspace(this.workspace.capacity).checkpoint(),
    );
    this.schedulingVersion = saved.scheduling?.version ?? 1;
    if (![1, 2, 3].includes(this.schedulingVersion))
      throw new Error("Unknown planner scheduling version");
    this.exclusiveKey = saved.scheduling?.exclusiveKey;
    this.lastPlayer = saved.scheduling?.lastPlayer ?? -1;
    this.lastCaller.clear();
    for (const [player, caller] of saved.scheduling?.lastCaller ?? [])
      this.lastCaller.set(player, caller);
    this.jobs.clear();
    for (const job of structuredClone(saved.jobs)) this.jobs.set(job.key, job);
    this.diagnostics.pending = this.jobs.size;
    this.diagnostics.workspaceUsed = this.workspace.used;
  }
  get pausesCommittedLimits(): boolean {
    return this.schedulingVersion >= 3;
  }
  has(key: string): boolean {
    const job = this.jobs.get(key);
    return !!job && (!job.discard || !!job.replacement);
  }
  private cohort(request: ExactRouteRequest<T>): PlannerCohort {
    const identity = this.ports.identity?.(request);
    const playerId =
      identity &&
      Number.isInteger(identity.playerId) &&
      identity.playerId >= 0 &&
      identity.playerId < 256
        ? identity.playerId
        : 0;
    const caller =
      identity && PLANNER_CALLERS.includes(identity.caller)
        ? identity.caller
        : "other";
    const key = `${playerId}:${caller}`;
    let cohort = this.cohorts.get(key);
    if (!cohort) {
      cohort = {
        playerId,
        caller,
        pending: 0,
        oldestAge: 0,
        work: 0,
        complete: 0,
        unreachable: 0,
        limited: 0,
        superseded: 0,
      };
      this.cohorts.set(key, cohort);
    }
    return cohort;
  }
  diagnosticCohorts(tick: number): PlannerCohort[] {
    for (const cohort of this.cohorts.values()) {
      cohort.pending = 0;
      cohort.oldestAge = 0;
    }
    // The authoritative queue has at most 128 entries, independent of world size.
    for (const job of this.jobs.values()) {
      const cohort = this.cohort(job);
      cohort.pending++;
      cohort.oldestAge = Math.max(cohort.oldestAge, tick - job.createdTick, 0);
    }
    return [...this.cohorts.values()].map((cohort) => ({ ...cohort }));
  }
  private selectJob(): [string, Job<T>] {
    if (this.schedulingVersion < 3) return this.nextJob();
    const exclusive = this.exclusiveKey && this.jobs.get(this.exclusiveKey);
    if (exclusive) return [exclusive.key, exclusive];
    this.exclusiveKey = undefined;
    let waiting = false;
    for (const job of this.jobs.values())
      if (job.waitingForWorkspace && !job.discard) {
        waiting = true;
        break;
      }
    if (!waiting) return this.nextJob();
    if (!this.workspace.used) {
      const next = this.nextJob(
        (job) => !!job.waitingForWorkspace && !job.discard,
      );
      next[1].waitingForWorkspace = false;
      this.exclusiveKey = next[0];
      return next;
    }
    // Stop new searches allocating while existing searches finish/release.
    // No progress is discarded. The finite arena holders must reach a terminal
    // result or capacity limit; cancellation cleanup keeps its fair turns.
    return this.nextJob(
      (job) =>
        job.search.nodes.size > 0 ||
        job.releasing !== undefined ||
        job.discard === true,
    );
  }
  private nextJob(
    eligible: (job: Job<T>) => boolean = () => true,
  ): [string, Job<T>] {
    if (this.schedulingVersion === 1) return this.jobs.entries().next().value!;
    // Three bounded scans of <=128 jobs, with no per-quantum group allocation.
    // Select a player first, then a command class, then its oldest queue entry.
    let firstPlayer = Infinity,
      nextPlayer = Infinity;
    for (const job of this.jobs.values())
      if (eligible(job)) {
        const { playerId } = this.cohort(job);
        firstPlayer = Math.min(firstPlayer, playerId);
        if (playerId > this.lastPlayer)
          nextPlayer = Math.min(nextPlayer, playerId);
      }
    const player = Number.isFinite(nextPlayer) ? nextPlayer : firstPlayer;
    const previous = this.lastCaller.get(player) ?? -1;
    let firstCaller = Infinity,
      nextCaller = Infinity;
    for (const job of this.jobs.values())
      if (eligible(job)) {
        const { playerId, caller } = this.cohort(job);
        if (playerId !== player) continue;
        const index = PLANNER_CALLERS.indexOf(caller);
        firstCaller = Math.min(firstCaller, index);
        if (index > previous) nextCaller = Math.min(nextCaller, index);
      }
    const caller = Number.isFinite(nextCaller) ? nextCaller : firstCaller;
    for (const [key, job] of this.jobs)
      if (eligible(job)) {
        const cohort = this.cohort(job);
        if (
          cohort.playerId !== player ||
          PLANNER_CALLERS.indexOf(cohort.caller) !== caller
        )
          continue;
        this.lastPlayer = player;
        this.lastCaller.set(player, caller);
        return [key, job];
      }
    throw new Error("Planner workspace has no eligible owner");
  }
  cancel(key: string): void {
    const job = this.jobs.get(key);
    if (job) {
      job.discard = true;
      job.replacement = undefined;
      job.releasing = "superseded";
    }
  }
  request(request: ExactRouteRequest<T>): boolean {
    if ((request.alternatives?.length ?? 0) > 31)
      throw new Error("Route request exceeds 32 finalists");
    const previous = this.jobs.get(request.key);
    if (previous) {
      previous.discard = true;
      previous.releasing = "superseded";
      previous.replacement = request;
      return true;
    }
    if (!this.jobs.has(request.key) && this.jobs.size >= this.jobLimit) {
      this.diagnostics.admissionDeferred++;
      return false;
    }
    const paths = request.water ? this.water : this.land;
    const search = paths.beginPlanning(
      this.workspace,
      request.start,
      request.goal,
    ).state;
    this.jobs.set(request.key, {
      ...request,
      search,
      output: [request.start],
      copied: 0,
      nextCandidate: 0,
      uncertain: false,
      prepared: !request.prepare,
    });
    this.diagnostics.pending = this.jobs.size;
    return true;
  }
  step(tick: number, budget = 4096, quantum = 64): number {
    if (
      !Number.isInteger(budget) ||
      budget < 0 ||
      !Number.isInteger(quantum) ||
      quantum < 1
    )
      throw new Error("Invalid route work budget");
    let used = 0;
    let preparationBudget = Math.min(256, budget),
      rayBudget = 32,
      idle = 0;
    while (this.jobs.size && used < budget) {
      const [key, job] = this.selectJob();
      this.jobs.delete(key);
      const cohort = this.cohort(job),
        before = used;
      try {
        let outcome: ExactRouteOutcome | undefined;
        const paths = job.water ? this.water : this.land;
        if (job.releasing) {
          const slice = Math.min(quantum, budget - used);
          let count = 0;
          // Reuse one iterator for this charged slice. Recreating it per node
          // repeatedly walks the deleted prefix of a large search map.
          const entries = job.search.nodes.entries();
          while (job.search.nodes.size && count < slice) {
            const [tile, slot] = entries.next().value!;
            this.workspace.release(slot);
            job.search.nodes.delete(tile);
            count++;
          }
          used += Math.max(1, count);
          if (job.search.nodes.size) {
            this.jobs.set(key, job);
            continue;
          }
          outcome = job.releasing;
          job.releasing = undefined;
          if (job.discard) {
            this.diagnostics.superseded++;
            cohort.superseded++;
            if (job.replacement) this.request(job.replacement);
            continue;
          }
          // Releasing a large search can span ticks. Its captured truth must
          // still be current at publication, even though search already ended.
          if (
            !this.ports.valid(job) ||
            paths.revision !== job.search.revision ||
            this.ports.obstacleRevision(job) !== job.obstacleRevision
          )
            outcome = "superseded";
        } else if (
          !this.ports.valid(job) ||
          paths.revision !== job.search.revision ||
          this.ports.obstacleRevision(job) !== job.obstacleRevision
        ) {
          outcome = "superseded";
          used++;
        } else {
          const slice = Math.min(quantum, budget - used);
          if (!job.prepared) {
            if (!preparationBudget) {
              this.jobs.set(key, job);
              if (++idle >= this.jobs.size) break;
              continue;
            }
            const result = this.ports.prepare?.(
              job,
              Math.min(slice, preparationBudget),
              rayBudget,
            );
            if (
              !result ||
              result.work < 0 ||
              result.work > Math.min(slice, preparationBudget)
            )
              throw new Error("Invalid route preparation budget");
            if ((result.rays ?? 0) > rayBudget || (result.rays ?? 0) < 0)
              throw new Error("Invalid LOS work budget");
            used += Math.max(1, result.work);
            preparationBudget -= Math.max(1, result.work);
            rayBudget -= result.rays ?? 0;
            idle = 0;
            if (result.failed) outcome = "unreachable";
            else if (result.goal !== undefined) {
              if ((result.alternatives?.length ?? 0) > 31)
                throw new Error("Route preparation exceeds 32 finalists");
              job.goal = result.goal;
              job.alternatives = result.alternatives;
              job.search = paths.beginPlanning(
                this.workspace,
                job.start,
                job.goal,
              ).state;
              job.prepared = true;
            }
          } else if (job.search.phase === "done") {
            const count = Math.min(slice, job.search.path.length - job.copied);
            for (let at = 0; at < count; at++)
              job.output.push(job.search.path[job.copied++]);
            used += Math.max(1, count);
            if (job.copied === job.search.path.length) outcome = "complete";
          } else {
            const search = paths.beginPlanning(
              this.workspace,
              job.start,
              job.goal,
              job.search,
            );
            used += Math.max(
              1,
              search.step(slice, paths.revision, this.ports.blocked(job)),
            );
            if (search.state.phase === "unreachable") outcome = "unreachable";
            else if (search.state.phase === "limited") outcome = "limited";
            else if (search.state.phase === "stale") outcome = "superseded";
          }
        }
        if (outcome && job.search.nodes.size) {
          job.releasing = outcome;
          this.jobs.set(key, job);
          continue;
        }
        if (
          outcome === "limited" &&
          this.schedulingVersion >= 3 &&
          !job.exclusiveRetry
        ) {
          // Retry exactly once with the full arena, after charged reclamation.
          // A full-arena failure remains actionable "limited", never geographic
          // impossibility. Finalist fallback stays inside the same reservation.
          job.exclusiveRetry = true;
          job.waitingForWorkspace = true;
          job.search = paths.beginPlanning(
            this.workspace,
            job.start,
            job.goal,
          ).state;
          job.output = [job.start];
          job.copied = 0;
          this.diagnostics.escalated++;
          this.jobs.set(key, job);
          continue;
        }
        if (
          (outcome === "unreachable" || outcome === "limited") &&
          job.prepared
        ) {
          job.uncertain ||= outcome === "limited";
          const next = job.alternatives?.[job.nextCandidate++];
          if (next !== undefined) {
            job.goal = next;
            job.search = paths.beginPlanning(
              this.workspace,
              job.start,
              next,
            ).state;
            outcome = undefined;
          } else if (job.uncertain) outcome = "limited";
        }
        if (outcome) {
          cohort[outcome]++;
          if (outcome === "complete") this.diagnostics.completed++;
          if (outcome === "limited") this.diagnostics.limited++;
          if (outcome === "superseded") this.diagnostics.superseded++;
          this.ports.completed(
            job,
            outcome,
            outcome === "complete" ? job.output : [],
          );
        } else this.jobs.set(key, job);
      } finally {
        cohort.work += used - before;
        if (this.exclusiveKey === key && this.jobs.get(key) !== job)
          this.exclusiveKey = undefined;
      }
    }
    this.diagnostics.work = used;
    this.diagnostics.pending = this.jobs.size;
    this.diagnostics.workspaceUsed = this.workspace.used;
    this.diagnostics.oldestAge = 0;
    for (const job of this.jobs.values())
      this.diagnostics.oldestAge = Math.max(
        this.diagnostics.oldestAge,
        tick - job.createdTick,
      );
    return used;
  }
}
