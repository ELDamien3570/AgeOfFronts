import {secondsToTicks} from './Protocol';
import type { LandPaths, WaterPaths, WaterShortcut } from "./Pathfinding";
import { PlanningWorkspace, type PlanningPathState } from "./PlanningWorkspace";
import type { CorridorState } from "./HierarchicalPaths";
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
  corridor?: CorridorState;
  /** Already published; only its arena slots remain to be reclaimed. */
  retired?: boolean;
  /** Its obstacle revision changed mid-search; the result is revalidated. */
  revalidate?: boolean;
  shortcut?: WaterShortcut;
}
export type ExactRouteOutcome =
  | "complete"
  | "unreachable"
  | "limited"
  | "superseded";
export interface RoutePlannerPorts<T> {
  /** Opt-in read-view revision for priority/commitment classification. Request
   * identity must be immutable; omit to keep live callback reads. */
  classificationRevision?(request: ExactRouteRequest<T>): string | number | boolean;
  /** False only for explicitly qualified legacy scheduling/profiles. */
  sharedPreparation?: boolean;
  /** Loaded civilian cargo is already committed economic work. */
  committed?(request: ExactRouteRequest<T>): boolean;
  /** Loan unused preparation capacity only while no interactive request waits. */
  lendIdlePreparation?: boolean;
  priority?(request: ExactRouteRequest<T>): boolean;
  /** Canonical autonomous planning deadline; omitted for exhaustive/player work. */
  deadlineTicks?(request: ExactRouteRequest<T>): number | undefined;
  /** Autonomous callers can decline exclusive arena retries without claiming
   * that a capacity-limited result means geographic impossibility. */
  allowExclusiveRetry?(request: ExactRouteRequest<T>): boolean;
  /** Whether HPA* may answer this request (default: interactive only). Owners
   * gate eligibility deterministically; cold cache preparation yields under
   * the scheduler's reserved work allowance. */
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
/** Owner decision D1 (R2-P3), scheduling version 5: planner slot partition
 * for the default 128-job queue. Humans hold at most 16 jobs per seat and 64
 * in total; background keeps a guaranteed 64 (16 of them for committed
 * trade) and may borrow idle interactive slots up to the version 4 limits.
 * Version 4 checkpoints keep uncapped interactive work.
 *
 * Scheduling version 6 (notes 16 rec 5, Next #1 remediation): a superseded or
 * finished job that only reclaims arena slots no longer holds its seat's
 * share, and `admissionReserve` of each seat's 16 slots are kept for movement
 * admission (the moves a player just ordered): a seat's per-squad navigation
 * work (pursuit, continuation, repair) takes at most 16 - 4 = 12. Background
 * corridors and background exact searches have separate active limits.
 * Version 5 checkpoints keep the version 5 counting. */
export const PLANNER_PARTITION = {
  interactivePerPlayer: 16,
  interactiveTotal: 64,
  committedReserve: 16,
  minimumJobLimit: 128,
  admissionReserve: 4,
} as const;
export class RoutePlanner<T> {
  private readonly jobs = new Map<string, Job<T>>();
  private readonly cohorts = new Map<string, PlannerCohort>();
  private classifications = new WeakMap<ExactRouteRequest<T>, { revision: string | number | boolean; priority: boolean; committed?: boolean }>();
  private cohortReads = new WeakMap<ExactRouteRequest<T>, PlannerCohort>();
  private classification(request: ExactRouteRequest<T>): { priority: boolean; committed?: boolean } {
    const revision = this.ports.classificationRevision?.(request);
    if (revision !== undefined) {
      const old = this.classifications.get(request);
      if (old?.revision === revision) return old;
    }
    const priority = !!this.ports.priority?.(request);
    if (revision !== undefined) {
      const value = { revision, priority };
      this.classifications.set(request, value);
      return value;
    }
    return { priority };
  }
  private priorityOf(request: ExactRouteRequest<T>): boolean {
    return this.ports.classificationRevision ? this.classification(request).priority : !!this.ports.priority?.(request);
  }
  private committedOf(request: ExactRouteRequest<T>): boolean {
    if (!this.ports.classificationRevision) return !!this.ports.committed?.(request);
    const facts = this.classification(request);
    return facts.committed ??= !!this.ports.committed?.(request);
  }
  private readonly workspace: PlanningWorkspace;
  // Retain the iterator across cleanup quanta. Starting a new Map iterator
  // repeatedly walks its deleted prefix even though only live slots are charged.
  private readonly reclamation = new WeakMap<Map<number, number>, MapIterator<[number, number]>>();
  // Version 1 restores historical FIFO checkpoints without changing their outcomes.
  // Version 5 adds the interactive/background slot partition (R2-P3).
  // Version 6 frees reclaiming slots and reserves admission slots per seat.
  private schedulingVersion = 6;
  private exclusiveKey?: string;
  private retiredJobs = 0;
  private lastPlayer = -1;
  private priorityTurn = 0;
  private backgroundTurn = 0;
  private currentTick = 0;
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
    if (ports.sharedPreparation === false) this.schedulingVersion = 3;
    if (!Number.isInteger(jobLimit) || jobLimit < 1 || jobLimit > 128)
      throw new Error("Invalid route queue limit");
    this.workspace = new PlanningWorkspace(workspaceCapacity);
    this.diagnostics.workspaceBytes = this.workspace.bytes;
  }
  checkpoint() {
    const saved = structuredClone({
      landRevision: this.land.revision,
      waterRevision: this.water.revision,
      amphibiousRevision: this.amphibious?.revision,
      jobs: [...this.jobs.values()],
      ...(this.schedulingVersion >= 4 ? { sharedPreparation: {
        land: this.land.sharedPreparationCheckpoint(), water: this.water.sharedPreparationCheckpoint(),
        amphibious: this.amphibious?.sharedPreparationCheckpoint(),
      } } : {}),
      workspace: this.workspace.checkpoint(),
      scheduling: {
        version: this.schedulingVersion,
        lastPlayer: this.lastPlayer,
        priorityTurn: this.priorityTurn,
        ...(this.schedulingVersion >= 4 ? { backgroundTurn: this.backgroundTurn } : {}),
        lastCaller: [...this.lastCaller],
        exclusiveKey: this.exclusiveKey,
        retired: this.retiredJobs,
      },
    });
    // Portable checkpoints support signed 32-bit arrays. Widen retained trees
    // here while keeping compact 16-bit local scratch during normal planning.
    for (const job of saved.jobs) if (job.corridor)
      for (const tree of [job.corridor.startTree, job.corridor.tree])
        if (tree?.parent instanceof Int16Array) tree.parent = Int32Array.from(tree.parent);
    return saved;
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
      (![1, 2, 3, 4, 5, 6].includes(scheduling.version) ||
        (scheduling.backgroundTurn !== undefined && (!Number.isSafeInteger(scheduling.backgroundTurn) || scheduling.backgroundTurn < 0)) ||
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
    if (![1, 2, 3, 4, 5, 6].includes(this.schedulingVersion))
      throw new Error("Unknown planner scheduling version");
    this.exclusiveKey = saved.scheduling?.exclusiveKey;
    this.retiredJobs = saved.scheduling?.retired ?? 0;
    if (!Number.isSafeInteger(this.retiredJobs) || this.retiredJobs < 0)
      throw new Error("Invalid planner scheduling checkpoint");
    this.lastPlayer = saved.scheduling?.lastPlayer ?? -1;
    this.priorityTurn = saved.scheduling?.priorityTurn ?? 0;
    this.backgroundTurn = saved.scheduling?.backgroundTurn ?? 0;
    if (this.schedulingVersion >= 4 && !saved.sharedPreparation) throw Error("Missing shared preparation checkpoint");
    this.land.restoreSharedPreparation(saved.sharedPreparation?.land);
    this.water.restoreSharedPreparation(saved.sharedPreparation?.water);
    this.amphibious?.restoreSharedPreparation(saved.sharedPreparation?.amphibious);
    this.lastCaller.clear();
    for (const [player, caller] of saved.scheduling?.lastCaller ?? [])
      this.lastCaller.set(player, caller);
    this.jobs.clear();
    this.classifications = new WeakMap();
    this.cohortReads = new WeakMap();
    for (const job of structuredClone(saved.jobs)) {
      if (job.shortcut) {
        if (this.schedulingVersion < 4 || !job.water) throw Error("Invalid shortcut owner");
        this.pathsFor(job).validateWaterShortcut(job.shortcut, job.start, job.goal);
      }
      if(job.corridor){
        // Portable transport preserves map values rather than object aliases.
        if(!(job.corridor.nodes instanceof Map) || job.corridor.nodes.size!==job.search.nodes.size ||
          [...job.search.nodes].some(([id,slot])=>job.corridor!.nodes.get(id)!==slot))throw Error("Corridor does not own its arena nodes");
        job.corridor.nodes=job.search.nodes;
        this.pathsFor(job).validateCorridor(job.corridor,this.workspace,this.schedulingVersion >= 4);
      }
      if (this.ports.allowExclusiveRetry?.(job) === false) {
        if(job.waitingForWorkspace!==undefined)job.waitingForWorkspace = false;
        if(job.resumeExclusiveAfterRelease!==undefined)job.resumeExclusiveAfterRelease = undefined;
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
  /** Actual bounded queue occupancy; never derived from timing telemetry. */
  get pendingCount():number{return this.jobs.size;}
  private cohort(request: ExactRouteRequest<T>): PlannerCohort {
    if (this.ports.classificationRevision) {
      const old = this.cohortReads.get(request);
      if (old) return old;
    }
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
        active: 0,
        oldestActiveAge: 0,
        reclaiming: 0,
        work: 0,
        complete: 0,
        unreachable: 0,
        limited: 0,
        superseded: 0,
      };
      this.cohorts.set(key, cohort);
    }
    if (this.ports.classificationRevision) this.cohortReads.set(request, cohort);
    return cohort;
  }
  diagnosticCohorts(tick: number): PlannerCohort[] {
    for (const cohort of this.cohorts.values()) {
      cohort.pending = 0;
      cohort.oldestAge = 0;
      cohort.active = cohort.oldestActiveAge = cohort.reclaiming = 0;
    }
    // The authoritative queue has at most 128 entries, independent of world size.
    for (const job of this.jobs.values()) {
      const cohort = this.cohort(job);
      cohort.pending++;
      cohort.oldestAge = Math.max(cohort.oldestAge, tick - job.createdTick, 0);
      if (job.retired || job.discard) cohort.reclaiming!++;
      const active = job.discard ? job.replacement : job.retired ? undefined : job;
      if (active) {
        cohort.active!++;
        cohort.oldestActiveAge = Math.max(cohort.oldestActiveAge!, tick - active.createdTick, 0);
      }
    }
    return [...this.cohorts.values()].map((cohort) => ({ ...cohort }));
  }
  private readonly eligibleJobs: Job<T>[] = [];
  private readonly eligiblePriorities: boolean[] = [];
  private selectJob(eligible: (job: Job<T>) => boolean = () => true): [string, Job<T>] | undefined {
    if (this.schedulingVersion < 3) {
      for (const job of this.jobs.values()) if (eligible(job)) return this.nextJob(eligible);
      return undefined;
    }
    // A quantum selects before processing any job or invoking its completion
    // callback. Eligibility and priority are stable during this selection only;
    // refresh both next quantum, including after domain mutations/completions.
    const available = this.eligibleJobs, priorities = this.eligiblePriorities;
    let humanPending = false;
    for (const job of this.jobs.values()) if (eligible(job)) {
      const priority = this.priorityOf(job);
      priorities.push(priority); available.push(job);
      if (!job.discard && priority) humanPending = true;
    }
    try {
      if (!available.length) return undefined;
      const exclusive = this.exclusiveKey && this.jobs.get(this.exclusiveKey);
      const exclusiveIndex = exclusive ? available.indexOf(exclusive) : -1;
      if (exclusive && exclusiveIndex >= 0 && (!humanPending || priorities[exclusiveIndex])) return [exclusive.key, exclusive];
      if (exclusive && !exclusive.releasing && exclusive.search.phase !== "done") {
        // An interactive request preempts an autonomous full-arena search.
        // Reclamation is charged normally; resume its retry after human work,
        // without publishing a false route failure to its domain owner.
        exclusive.releasing = "limited";
        exclusive.resumeExclusiveAfterRelease = true;
      }
      this.exclusiveKey = undefined;
      const canReserve = (job: Job<T>) => !!job.waitingForWorkspace && !job.discard &&
        (!humanPending || this.priorityOf(job));
      let waiting = false;
      for (const job of available)
        if (canReserve(job)) {
          waiting = true;
          break;
        }
      if (!waiting) return this.nextJob(job => !job.waitingForWorkspace || job.releasing !== undefined || !!job.discard, available, priorities);
      if (!this.workspace.used) {
        const next = this.nextJob(
          canReserve, available, priorities,
        );
        next[1].waitingForWorkspace = false;
        this.exclusiveKey = next[0];
        return next;
      }
      // Stop new searches allocating while existing searches finish/release.
      // No progress is discarded. The finite arena holders must reach a terminal
      // result or capacity limit; cancellation cleanup keeps its fair turns.
      const holder = (job: Job<T>) => (
          job.search.nodes.size > 0 ||
          job.releasing !== undefined ||
          job.discard === true);
      let held = false;
      for (const job of available) if (holder(job)) { held = true; break; }
      if (!held) return undefined;
      return this.nextJob(holder, available, priorities);
    } finally {
      // Scratch must not retain retired jobs and their search arenas.
      available.length = 0; priorities.length = 0;
    }
  }
  private readonly selectionCandidates: Job<T>[] = [];
  private readonly selectionClasses: number[] = [];
  private nextJob(
    eligible: (job: Job<T>) => boolean = () => true,
    available?: readonly Job<T>[],
    priorities?: readonly boolean[],
  ): [string, Job<T>] {
    if (this.schedulingVersion === 1) return this.jobs.entries().next().value!;
    // Classify each eligible job once. Priority/committed queries are derived
    // world reads; repeated full scans per quantum used to repeat both reads.
    const candidates = this.selectionCandidates, classes = this.selectionClasses;
    candidates.length = 0;
    let human = false, background = false, loaded = false, fresh = false;
    let ordinal = -1;
    for (const job of available ?? this.jobs.values()) {
      ordinal++;
      if (!eligible(job)) continue;
      const interactive = priorities?.[ordinal] ?? this.priorityOf(job);
      const urgent = this.schedulingVersion >= 4 && !!this.ports.committed &&
        (this.committedOf(job) || this.currentTick - job.createdTick >= secondsToTicks(5));
      const at = candidates.length;
      candidates.push(job); classes[at] = Number(interactive) | (Number(urgent) << 1);
      if (interactive) human = true;
      else { background = true; if (urgent) loaded = true; else fresh = true; }
    }
    const priority = human && background ? this.priorityTurn++ % 3 < 2 : undefined;
    // The previous scheduler tested urgency only after its priority filter.
    const protectedTurn = priority !== true && loaded && fresh && this.schedulingVersion >= 4 && this.ports.committed
      ? this.backgroundTurn++ % 4 < 3 : undefined;
    for (const key of this.selectionKeys) this.selection[key] = undefined;
    this.selectionKeys.length = 0;
    let firstPlayer = Infinity, nextPlayer = Infinity;
    for (let at = 0; at < candidates.length; at++) {
      const job = candidates[at], interactive = !!(classes[at] & 1), urgent = !!(classes[at] & 2);
      if (priority !== undefined && interactive !== priority ||
          protectedTurn !== undefined && !interactive && urgent !== protectedTurn) continue;
      const { playerId, caller } = this.cohort(job);
      const key = playerId * PLANNER_CALLERS.length + PLANNER_CALLERS.indexOf(caller);
      if (!this.selection[key]) { this.selection[key] = job; this.selectionKeys.push(key); }
      firstPlayer = Math.min(firstPlayer, playerId);
      if (playerId > this.lastPlayer) nextPlayer = Math.min(nextPlayer, playerId);
    }
    candidates.length = 0;
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
    if(job.corridor)job.corridor.validated=0;
    return true;
  }
  /** The cohort's player without creating a diagnostics cohort row. */
  private playerOf(request: ExactRouteRequest<T>): number {
    const read = this.cohortReads.get(request);
    if (read) return read.playerId;
    const id = this.ports.identity?.(request)?.playerId;
    return id !== undefined && Number.isInteger(id) && id >= 0 && id < 256 ? id : 0;
  }
  /** The caller class without creating a diagnostics cohort row. */
  private callerOf(request: ExactRouteRequest<T>): PlannerCaller | undefined {
    return this.cohortReads.get(request)?.caller ?? this.ports.identity?.(request)?.caller;
  }
  /** Scheduling v5 slot partition (R2-P3) on the full-size queue. */
  private get partitioned(): boolean {
    return this.schedulingVersion >= 5 && !!this.ports.priority && this.jobLimit >= PLANNER_PARTITION.minimumJobLimit;
  }
  /** Interactive (human) jobs take at most 16 slots per player and 64 in
   * total, so background work always keeps the other half (48 for ordinary
   * background, 16 more for committed trade). Background work may still grow
   * up to the version 4 thresholds (104 uncommitted, 120 total) when humans
   * leave their share idle, so a match without busy humans schedules exactly
   * as version 4 did. Counts scan the bounded queue under the current
   * classification epoch, so no per-job flag can go stale when a seat changes
   * control. Same-key replacements return before this check. */
  private partitionRefuses(request: ExactRouteRequest<T>): boolean {
    const priority = this.priorityOf(request), playerId = priority ? this.playerOf(request) : -1;
    const v6 = this.schedulingVersion >= 6, navigation = v6 && priority && this.callerOf(request) !== "admission";
    let interactive = 0, player = 0, playerNavigation = 0, background = 0;
    for (const job of this.jobs.values()) {
      // Rec 5 (v6): a superseded or finished job only reclaims its arena
      // slots; it no longer holds its seat's share, so a replacement order
      // gets the slot on the tick the old one is cancelled. (Reclaiming
      // entries still count toward the whole table's jobLimit.)
      if (v6 && (job.retired || (job.discard && !job.replacement))) continue;
      if (this.priorityOf(job)) {
        interactive++;
        if (priority && this.playerOf(job) === playerId) {
          player++;
          if (navigation && this.callerOf(job) !== "admission") playerNavigation++;
        }
      } else background++;
    }
    if (priority)
      return interactive >= PLANNER_PARTITION.interactiveTotal || player >= PLANNER_PARTITION.interactivePerPlayer ||
        navigation && playerNavigation >= PLANNER_PARTITION.interactivePerPlayer - PLANNER_PARTITION.admissionReserve;
    const share = this.jobLimit - PLANNER_PARTITION.interactiveTotal, size = this.jobs.size;
    if (background >= share && size >= this.jobLimit - 8) return true;
    return !!this.ports.committed && !this.committedOf(request) &&
      background >= share - PLANNER_PARTITION.committedReserve && size >= this.jobLimit - 24;
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
    if (this.partitioned) {
      if (this.partitionRefuses(request)) { this.diagnostics.admissionDeferred++; return false; }
    } else {
      if (this.ports.priority && !this.priorityOf(request) && this.jobLimit >= 16 && this.jobs.size >= this.jobLimit - 8) {
        this.diagnostics.admissionDeferred++; return false;
      }
      if (this.schedulingVersion >= 4 && this.ports.committed && !this.priorityOf(request) &&
        !this.committedOf(request) && this.jobLimit >= 32 && this.jobs.size >= this.jobLimit - 24) {
        this.diagnostics.admissionDeferred++; return false;
      }
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
      ...(this.schedulingVersion >= 4 && request.water && !request.prepare && !this.ports.blocked(request) ?
        { shortcut: paths.beginWaterShortcut(request.start, request.goal) } : {}),
    });
    this.diagnostics.pending = this.jobs.size;
    return true;
  }
  private readonly pinFamilies = new Map<object, number[]>();
  step(tick: number, budget = 4096, quantum = 64): number {
    this.currentTick = tick;
    if (
      !Number.isInteger(budget) ||
      budget < 0 ||
      !Number.isInteger(quantum) ||
      quantum < 1
    )
      throw new Error("Invalid route work budget");
    // Terminal receipts do not wait for arena reclamation. Cleanup remains
    // scheduled and charged, just as it does after a completed route.
    for (const job of [...this.jobs.values()]) {
      if (job.retired) continue;
      const request = job.discard ? job.replacement : job;
      if (!request) continue;
      const deadline = this.ports.deadlineTicks?.(request);
      if (deadline === undefined) continue;
      if (!Number.isSafeInteger(deadline) || deadline < 1) throw new Error("Invalid route deadline");
      if (tick - request.createdTick < deadline) continue;
      if (job.discard) job.replacement = undefined;
      else {
        this.jobs.delete(job.key);
        if (this.exclusiveKey === job.key) this.exclusiveKey = undefined;
        if (job.search.nodes.size) {
          const key = `${job.key}#retired:${this.retiredJobs++}`;
          this.jobs.set(key, { ...job, key,
            search: { ...job.search, path: [], heap: [] }, output: [],
            corridor: undefined, retired: true, discard: true, releasing: "limited",
            replacement: undefined, waitingForWorkspace: false, resumeExclusiveAfterRelease: undefined });
        }
      }
      this.cohort(request).limited++;
      this.diagnostics.limited++;
      this.ports.completed(request, "limited", []);
    }
    let used = 0;
    if (this.schedulingVersion >= 4) {
      // P36: one pass over the table instead of a spread, filter and flatMap
      // per path family. Each family still receives its origins in job order.
      const families = this.pinFamilies;
      families.clear();
      for (const paths of [this.land, this.water, this.amphibious]) if (paths && !families.has(paths)) families.set(paths, []);
      for (const job of this.jobs.values()) {
        const origin = job.corridor?.local?.origin;
        if (origin !== undefined) families.get(this.pathsFor(job))?.push(origin);
      }
      for (const paths of [this.land, this.water, this.amphibious]) if (paths) paths.pinSharedPreparation(families.get(paths)!);
      families.clear();
    }
    let humanWaiting = false;
    if (this.ports.lendIdlePreparation && this.ports.priority) for (const job of this.jobs.values()) {
      const live=job.discard?job.replacement:job.retired?undefined:job;
      if (live && this.priorityOf(live)) { humanWaiting = true; break; }
    }
    let preparationBudget = Math.min(Math.ceil(budget/16), budget),
      // At most 16,384 local dequeues, with 12,288 reserved for human work.
      corridorPreparationBudget = Math.min(32, budget),
      backgroundCorridorPreparationBudget = Math.min(this.ports.lendIdlePreparation && !humanWaiting ? 32 : 8, budget),
      rayBudget = 32,
      idle = 0;
    // Exhausted background preparation cannot progress again until next tick.
    // Exclude it once instead of rescanning it between every runnable quantum.
    // Human requests retain the existing priority/idle circuit breaker.
    const deferred = new Set<Job<T>>();
    while (this.jobs.size && used < budget) {
      const selected = this.selectJob(job => !deferred.has(job));
      if (!selected) break;
      const [key, job] = selected;
      this.jobs.delete(key);
      const cohort = this.cohort(job),
        before = used;
      try {
        let outcome: ExactRouteOutcome | undefined;
        const paths = this.pathsFor(job);
        if (job.releasing) {
          const slice = Math.min(quantum, budget - used);
          let count = 0;
          let entries = this.reclamation.get(job.search.nodes);
          if (!entries) this.reclamation.set(job.search.nodes, entries = job.search.nodes.entries());
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
          this.reclamation.delete(job.search.nodes);
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
          // The static certificate proves terrain only. A newly introduced
          // dynamic access mask must use the ordinary validated search.
          if (job.shortcut && this.ports.blocked(job)) job.shortcut = undefined;
          if (job.shortcut) {
            used += Math.max(1, paths.stepWaterShortcut(job.shortcut, slice));
            if (job.shortcut.phase === "done") { job.output = job.shortcut.path; job.shortcut = undefined; outcome = "complete"; }
            else if (job.shortcut.phase === "failed") { job.shortcut = undefined; this.jobs.set(key, job); continue; }
            else { this.jobs.set(key, job); continue; }
          }
          if (!outcome && this.schedulingVersion >= 4 && !job.prepare && !this.priorityOf(job) &&
            !job.corridor && !job.search.nodes.size && job.search.phase === "search") {
            // Queue capacity is not arena concurrency. Admit a bounded number
            // of background searches; retain the rest without reporting a
            // false capacity failure or discarding their logical request.
            // v6: corridors and exact searches are limited separately. A
            // corridor is held by the shared per-tick preparation allowance,
            // an exact search by arena work; counting both against one limit
            // let cold trade corridors starve every exact background search
            // (Mig 500: 16 corridors held 70+ AI admissions for minutes).
            // Corridors keep their own limit, so the preparation allowance
            // still concentrates on a few of them.
            const split = this.schedulingVersion >= 6,
              corridorNext = split && !job.corridorTried && !job.exclusiveRetry && job.nextCandidate === 0 &&
                !!this.ports.corridorReady?.(job);
            let active = 0;
            for (const other of this.jobs.values()) if (!other.retired && !other.discard &&
              !this.priorityOf(other) && (other.corridor || other.search.nodes.size) &&
              (!split || !!other.corridor === corridorNext)) active++;
            const limit = this.ports.committed && !this.committedOf(job) ? 12 : 16;
            if (active >= limit) {
              this.jobs.set(key, job); deferred.add(job); used++; continue;
            }
          }
          if (outcome) { /* Certified shortcut publishes through the normal commit below. */ }
          else if (!job.prepared) {
            if (!preparationBudget) {
              this.jobs.set(key, job);
              if (!this.priorityOf(job)) deferred.add(job);
              else if (++idle >= this.jobs.size) break;
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
          } else if (job.corridor) {
            const priority = this.priorityOf(job);
            const preparation = { used: 0 }, work = paths.stepCorridor(
              job.corridor, this.workspace, slice, this.ports.blocked(job),
              priority ? corridorPreparationBudget : Math.min(corridorPreparationBudget, backgroundCorridorPreparationBudget),
              preparation,
              this.schedulingVersion >= 4,
            );
            corridorPreparationBudget -= preparation.used;
            if (!priority) backgroundCorridorPreparationBudget -= preparation.used;
            if (!work) {
              this.jobs.set(key, job);
              if (!this.priorityOf(job)) deferred.add(job);
              else if (++idle >= this.jobs.size) break;
              continue;
            }
            idle = 0;
            used += work;
            if (job.corridor.phase === "done") {
              job.output = job.corridor.path;
              job.corridor = undefined;
              outcome = "complete";
            } else if (job.corridor.phase === "failed") job.corridor = undefined;
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
            budget - used >= 1024 &&
            (this.ports.corridorReady?.(job) ?? this.priorityOf(job))
          ) {
            // Preparation, graph search, refinement, validation and fallback
            // cleanup all yield under the same fair work allowance.
            job.corridorTried = true;
            job.corridor = paths.beginCorridor(job.start, job.goal, job.search.nodes);
            // Integer route costs remain primary. Prefer progress toward the
            // goal on equal-cost water plateaus instead of filling the arena.
            if (job.corridor && this.schedulingVersion >= 4) job.corridor.heap.precise = true;
            used++;
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
