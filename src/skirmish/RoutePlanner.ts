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
  /** Land route over the amphibious graph (squads that may cross water). */
  amphibious?: boolean;
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
  resumeExclusiveAfterRelease?: boolean;
  /** Interactive jobs try one hierarchical corridor before exact search. */
  corridorTried?: boolean;
  /** Already published; only its arena slots remain to be reclaimed. */
  retired?: boolean;
  /** Its obstacle revision changed mid-search; the result is revalidated. */
  revalidate?: boolean;
}
/** Allowance an interactive HPA* corridor attempt needs left in the tick:
 * about one start-cluster tree plus a short abstract search. */
const CORRIDOR_RESERVE = 1024;
export type ExactRouteOutcome =
  | "complete"
  | "unreachable"
  | "limited"
  | "superseded";
export interface RoutePlannerPorts<T> {
  priority?(request: ExactRouteRequest<T>): boolean;
  /** Autonomous callers can decline exclusive arena retries without claiming
   * that a capacity-limited result means geographic impossibility. */
  allowExclusiveRetry?(request: ExactRouteRequest<T>): boolean;
  /** Whether the HPA* corridor may answer an interactive request. A cold
   * hierarchy builds crossing trees inside the query, outside any budget; the
   * owner gates this on a deterministic schedule, never on cache state. */
  corridorReady?(request: ExactRouteRequest<T>): boolean;
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

/** Checkpointed, fair exact work shared by land and water callers. Search
 * and reconstruction yield inside a job. Domain owners validate its generation
 * and revisions before atomically accepting a result.
 *
 * Terrain cost epochs (forest clearing under new buildings) never invalidate
 * a job: they change travel cost, not walkability, so an unfinished search or
 * a finished path stays legal. An obstacle revision restarts only jobs with
 * prepared goals; plain routes keep searching under the live mask and are
 * revalidated against it on completion.
 */
export class RoutePlanner<T> {
  private readonly jobs = new Map<string, Job<T>>();
  private readonly cohorts = new Map<string, PlannerCohort>();
  private readonly workspace: PlanningWorkspace;
  // Version 1 restores historical FIFO checkpoints without changing their outcomes.
  private schedulingVersion = 3;
  private exclusiveKey?: string;
  private retiredJobs = 0;
  private lastPlayer = -1;
  private priorityTurn = 0;
  private readonly lastCaller = new Map<number, number>();
  private readonly selection = new Array<Job<T> | undefined>(256 * PLANNER_CALLERS.length);
  private readonly selectionKeys: number[] = [];
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
    private readonly amphibious?: LandPaths,
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
      amphibiousRevision: this.amphibious?.revision,
      jobs: [...this.jobs.values()],
      workspace: this.workspace.checkpoint(),
      scheduling: {
        version: this.schedulingVersion,
        lastPlayer: this.lastPlayer,
        priorityTurn: this.priorityTurn,
        lastCaller: [...this.lastCaller],
        exclusiveKey: this.exclusiveKey,
        retired: this.retiredJobs,
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
        (scheduling.priorityTurn !== undefined && (!Number.isSafeInteger(scheduling.priorityTurn) || scheduling.priorityTurn < 0)) ||
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
    if (saved.amphibiousRevision !== undefined) this.amphibious?.restoreRevision(saved.amphibiousRevision);
    this.workspace.restore(
      saved.workspace ??
        new PlanningWorkspace(this.workspace.capacity).checkpoint(),
    );
    this.schedulingVersion = saved.scheduling?.version ?? 1;
    if (![1, 2, 3].includes(this.schedulingVersion))
      throw new Error("Unknown planner scheduling version");
    this.exclusiveKey = saved.scheduling?.exclusiveKey;
    this.retiredJobs = saved.scheduling?.retired ?? 0;
    if (!Number.isSafeInteger(this.retiredJobs) || this.retiredJobs < 0)
      throw new Error("Invalid planner scheduling checkpoint");
    this.lastPlayer = saved.scheduling?.lastPlayer ?? -1;
    this.priorityTurn = saved.scheduling?.priorityTurn ?? 0;
    this.lastCaller.clear();
    for (const [player, caller] of saved.scheduling?.lastCaller ?? [])
      this.lastCaller.set(player, caller);
    this.jobs.clear();
    for (const job of structuredClone(saved.jobs)) {
      if (this.ports.allowExclusiveRetry?.(job) === false) {
        job.waitingForWorkspace = false;
        job.resumeExclusiveAfterRelease = undefined;
        if (this.exclusiveKey === job.key) this.exclusiveKey = undefined;
      }
      this.jobs.set(job.key, job);
    }
    this.diagnostics.pending = this.jobs.size;
    this.diagnostics.workspaceUsed = this.workspace.used;
  }
  private pathsFor(request: ExactRouteRequest<T>): LandPaths | WaterPaths {
    if (request.water) return this.water;
    return request.amphibious && this.amphibious ? this.amphibious : this.land;
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
    let humanPending = false;
    if (this.ports.priority) for (const job of this.jobs.values())
      if (!job.discard && this.ports.priority(job)) { humanPending = true; break; }
    const exclusive = this.exclusiveKey && this.jobs.get(this.exclusiveKey);
    if (exclusive && (!humanPending || this.ports.priority!(exclusive))) return [exclusive.key, exclusive];
    if (exclusive && !exclusive.releasing && exclusive.search.phase !== "done") {
      // An interactive request preempts an autonomous full-arena search.
      // Reclamation is charged normally; resume its retry after human work,
      // without publishing a false route failure to its domain owner.
      exclusive.releasing = "limited";
      exclusive.resumeExclusiveAfterRelease = true;
    }
    this.exclusiveKey = undefined;
    const canReserve = (job: Job<T>) => !!job.waitingForWorkspace && !job.discard &&
      (!humanPending || this.ports.priority!(job));
    let waiting = false;
    for (const job of this.jobs.values())
      if (canReserve(job)) {
        waiting = true;
        break;
      }
    if (!waiting) return this.nextJob(job => !job.waitingForWorkspace || job.releasing !== undefined || !!job.discard);
    if (!this.workspace.used) {
      const next = this.nextJob(
        canReserve,
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
    if (this.ports.priority) {
      let human = false, background = false;
      for (const job of this.jobs.values()) if (eligible(job)) {
        if (this.ports.priority(job)) human = true; else background = true;
      }
      if (human && background) {
        const priority = this.priorityTurn++ % 3 < 2, prior = eligible;
        eligible = job => prior(job) && this.ports.priority!(job) === priority;
      }
    }
    // One queue scan records each cohort's first eligible entry. Selection still
    // rotates players, then callers, then takes that cohort's original FIFO head.
    // Scratch is dense and bounded; cohort identity is re-read for every quantum.
    for (const key of this.selectionKeys) this.selection[key] = undefined;
    this.selectionKeys.length = 0;
    let firstPlayer = Infinity,
      nextPlayer = Infinity;
    for (const job of this.jobs.values())
      if (eligible(job)) {
        const { playerId, caller } = this.cohort(job);
        const key = playerId * PLANNER_CALLERS.length + PLANNER_CALLERS.indexOf(caller);
        if (!this.selection[key]) {
          this.selection[key] = job;
          this.selectionKeys.push(key);
        }
        firstPlayer = Math.min(firstPlayer, playerId);
        if (playerId > this.lastPlayer)
          nextPlayer = Math.min(nextPlayer, playerId);
      }
    const player = Number.isFinite(nextPlayer) ? nextPlayer : firstPlayer;
    const previous = this.lastCaller.get(player) ?? -1;
    let firstCaller = Infinity,
      nextCaller = Infinity;
    for (let index = 0; index < PLANNER_CALLERS.length; index++)
      if (this.selection[player * PLANNER_CALLERS.length + index]) {
        firstCaller = Math.min(firstCaller, index);
        if (index > previous) nextCaller = Math.min(nextCaller, index);
      }
    const caller = Number.isFinite(nextCaller) ? nextCaller : firstCaller;
    const selected = this.selection[player * PLANNER_CALLERS.length + caller];
    // Do not retain retired search workspaces through derived scheduler scratch.
    for (const key of this.selectionKeys) this.selection[key] = undefined;
    this.selectionKeys.length = 0;
    if (selected) {
      this.lastPlayer = player;
      this.lastCaller.set(player, caller);
      return [selected.key, selected];
    }
    throw new Error("Planner workspace has no eligible owner");
  }
  /** Walls and policy masks are read live by every search step. A plain route
   * keeps its progress through an obstacle change and is checked against the
   * current mask when it completes; prepared goals still restart. */
  private adoptObstacleRevision(job: Job<T>): boolean {
    if (job.prepare) return false;
    job.obstacleRevision = this.ports.obstacleRevision(job);
    job.revalidate = true;
    return true;
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
    if (this.ports.priority && !this.ports.priority(request) && this.jobLimit >= 16 && this.jobs.size >= this.jobLimit - 8) {
      this.diagnostics.admissionDeferred++; return false;
    }
    const paths = this.pathsFor(request);
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
        const paths = this.pathsFor(job);
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
          if (job.retired) continue;
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
            this.ports.obstacleRevision(job) !== job.obstacleRevision
          )
            outcome = "superseded";
          if (job.resumeExclusiveAfterRelease) {
            job.resumeExclusiveAfterRelease = undefined;
            if (outcome !== "superseded") {
              job.search = paths.beginPlanning(this.workspace, job.start, job.goal).state;
              job.output = [job.start];
              job.copied = 0;
              job.waitingForWorkspace = true;
              this.jobs.set(key, job);
              continue;
            }
          }
        } else if (
          !this.ports.valid(job) ||
          (this.ports.obstacleRevision(job) !== job.obstacleRevision &&
            !this.adoptObstacleRevision(job))
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
            // The reconstructed path is ordinary storage, independent of the
            // arena, so it publishes before any slot reclamation.
            job.output = [job.start, ...job.search.path];
            job.copied = job.search.path.length;
            used++;
            outcome = job.revalidate && !paths.routeClear(job.output, this.ports.blocked(job))
              ? "superseded" : "complete";
          } else if (
            !job.corridorTried &&
            !job.exclusiveRetry &&
            job.nextCandidate === 0 &&
            job.search.phase === "search" &&
            !job.search.nodes.size &&
            budget - used >= CORRIDOR_RESERVE &&
            this.ports.priority?.(job) &&
            (this.ports.corridorReady?.(job) ?? true)
          ) {
            // An interactive order first tries the static HPA* corridor, which
            // costs a few cluster crossings instead of a tile-level search of
            // the whole map. Any failure resumes the exact search unchanged.
            // It is attempted only with a reserve left, so one corridor query
            // is the most a tick can exceed its allowance by.
            job.corridorTried = true;
            const before = paths.work,
              route = paths.hierarchical(job.start, job.goal, this.ports.blocked(job));
            used += Math.max(1, paths.work - before);
            if (route) {
              job.output = [job.start, ...route];
              outcome = "complete";
            }
          } else {
            const search = paths.beginPlanning(
              this.workspace,
              job.start,
              job.goal,
              job.search,
            );
            used += Math.max(
              1,
              search.step(slice, job.search.revision, this.ports.blocked(job)),
            );
            // Disconnection proven partly under replaced obstacles is not proof.
            if (search.state.phase === "unreachable") outcome = job.revalidate ? "superseded" : "unreachable";
            else if (search.state.phase === "limited") outcome = "limited";
            else if (search.state.phase === "stale") outcome = "superseded";
          }
        }
        if (outcome === "complete" && job.search.nodes.size) {
          // Publish now; reclaim the finished search under its own key so a
          // follow-up request for the same owner starts without waiting.
          const retiredKey = `${key}#retired:${this.retiredJobs++}`;
          this.jobs.set(retiredKey, {
            ...job,
            key: retiredKey,
            search: { ...job.search, path: [], heap: [] },
            output: [],
            retired: true,
            discard: true,
            releasing: "superseded",
            replacement: undefined,
            waitingForWorkspace: false,
            resumeExclusiveAfterRelease: undefined,
          });
        } else if (outcome && job.search.nodes.size) {
          job.releasing = outcome;
          this.jobs.set(key, job);
          continue;
        }
        if (
          outcome === "limited" &&
          this.schedulingVersion >= 3 &&
          this.ports.allowExclusiveRetry?.(job) !== false &&
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
