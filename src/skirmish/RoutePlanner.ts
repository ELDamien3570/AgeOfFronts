import type { LandPaths, WaterPaths } from "./Pathfinding";
import { PlanningWorkspace, type PlanningPathState } from "./PlanningWorkspace";

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
}
export type ExactRouteOutcome =
  | "complete"
  | "unreachable"
  | "limited"
  | "superseded";
export interface RoutePlannerPorts<T> {
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
  private readonly workspace: PlanningWorkspace;
  readonly diagnostics = {
    work: 0,
    pending: 0,
    oldestAge: 0,
    completed: 0,
    limited: 0,
    superseded: 0,
    admissionDeferred: 0,
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
    });
  }
  restore(saved: ReturnType<RoutePlanner<T>["checkpoint"]>): void {
    if (saved.jobs.length > this.jobLimit)
      throw new Error("Route checkpoint exceeds queue limit");
    this.land.restoreRevision(saved.landRevision);
    this.water.restoreRevision(saved.waterRevision);
    this.workspace.restore(saved.workspace);
    this.jobs.clear();
    for (const job of structuredClone(saved.jobs)) this.jobs.set(job.key, job);
    this.diagnostics.pending = this.jobs.size;
    this.diagnostics.workspaceUsed = this.workspace.used;
  }
  has(key: string): boolean {
    const job = this.jobs.get(key);
    return !!job && (!job.discard || !!job.replacement);
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
      const [key, job] = this.jobs.entries().next().value!;
      this.jobs.delete(key);
      let outcome: ExactRouteOutcome | undefined;
      const paths = job.water ? this.water : this.land;
      if (job.releasing) {
        const slice = Math.min(quantum, budget - used);
        let count = 0;
        while (job.search.nodes.size && count < slice) {
          const [tile, slot] = job.search.nodes.entries().next().value!;
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
        if (outcome === "complete") this.diagnostics.completed++;
        if (outcome === "limited") this.diagnostics.limited++;
        if (outcome === "superseded") this.diagnostics.superseded++;
        this.ports.completed(
          job,
          outcome,
          outcome === "complete" ? job.output : [],
        );
      } else this.jobs.set(key, job);
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
