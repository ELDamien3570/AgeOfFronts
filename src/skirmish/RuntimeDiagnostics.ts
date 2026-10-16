export const RUNTIME_PHASES = [
  "setup", "economy", "ai", "ships", "routing", "movement", "combat",
  "capture", "transport", "cleanup", "tick", "queue", "commands",
  "snapshot", "encoding", "advance",
  "validation", "admission", "scheduler", "extraction", "pack", "json",
  "bufferCopy", "compression", "hash", "base64", "transfer", "fanout", "socket",
  "decode", "decompression", "unpack", "apply", "projection", "hud",
  "frame", "frameInterval", "presentation", "recovery", "gc",
  "hud.recruitment-feed", "hud.counters", "hud.quotes", "hud.selection",
  "hud.empire", "hud.cards", "hud.armies", "hud.roster",
  "simulate",
] as const;
export type RuntimePhase = (typeof RUNTIME_PHASES)[number];
export interface TimingSummary { samples: number; mean: number; p95: number; p99: number; maximum: number }
export const TIMING_BUCKET_LIMITS = [1, 2, 4, 8, 16, 25, 35, 45, 50, 75, 100, 200, 500, 1000, Infinity] as const;
export interface LifetimeTimingSummary {
  samples: number; mean: number; maximum: number; above50Ms: number; above100Ms: number;
  /** Disjoint buckets, upper bounds inclusive. The last bound is unbounded.
   * These whole-run counts are not exact rolling-window percentiles. */
  buckets: { upperMs: number | null; samples: number }[];
}

/** Wall time over thread CPU time above which a measurement window is flagged
 * as host-contended (review-notes 16/22: round-2 numbers ran at about 2). */
export const WALL_PER_CPU_FLAG = 1.5;
/** Ticks per thread-CPU window. Windows thread clocks tick in about 15.6 ms
 * steps, so only means over at least this many ticks are trusted. */
export const CPU_WINDOW_TICKS = 400;
/** Milliseconds of CPU used by the calling thread, or undefined when the host
 * has no per-thread clock (browsers). Never process.cpuUsage(): that is
 * process-wide and includes the snapshot encoder thread. */
export type CpuClock = () => number | undefined;
export const threadCpuClock: CpuClock = () => {
  const usage = (globalThis as { process?: { threadCpuUsage?: () => { user: number; system: number } } }).process?.threadCpuUsage?.();
  return usage ? (usage.user + usage.system) / 1000 : undefined;
};
export interface CpuSummary {
  samples: number; wallMs: number; threadMs: number; meanWallMs: number; meanThreadMs: number;
  /** Undefined while no CPU time was observed. */
  wallPerCpu?: number; flagged: boolean;
}
const validCpu = (ms: number | undefined): ms is number => ms !== undefined && Number.isFinite(ms) && ms >= 0;
const cpuSummary = (samples: number, wallMs: number, threadMs: number): CpuSummary => {
  const wallPerCpu = threadMs > 0 ? wallMs / threadMs : undefined;
  return { samples, wallMs, threadMs, meanWallMs: samples ? wallMs / samples : 0, meanThreadMs: samples ? threadMs / samples : 0,
    wallPerCpu, flagged: wallPerCpu !== undefined && wallPerCpu > WALL_PER_CPU_FLAG };
};

/** Bounded diagnostic history only. These clocks never feed gameplay or
 * planner budgets and are deliberately excluded from world checkpoints. */
export class RuntimeDiagnostics {
  private readonly windows = new Map<RuntimePhase, { values: Float64Array; cursor: number; count: number;
    lifetime: { count: number; total: number; maximum: number; above50: number; above100: number; buckets: Float64Array } }>();
  // Paired wall/thread-CPU samples, kept only for phases that supplied CPU.
  private readonly cpuWindows = new Map<RuntimePhase, { wall: Float64Array; cpu: Float64Array; cursor: number; count: number }>();
  constructor(readonly capacity = 256, readonly enabled = true, private readonly cpuClock?: CpuClock) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096) throw new Error("Invalid diagnostic window");
  }
  /** Thread CPU now, or undefined when this instance has no CPU clock. */
  cpuNow(): number | undefined {
    if (!this.enabled || !this.cpuClock) return undefined;
    const value = this.cpuClock();
    return validCpu(value) ? value : undefined;
  }
  record(phase: RuntimePhase, ms: number, cpuMs?: number): void {
    if (!this.enabled || !Number.isFinite(ms) || ms < 0 || !RUNTIME_PHASES.includes(phase)) return;
    if (validCpu(cpuMs)) {
      let cpu = this.cpuWindows.get(phase);
      if (!cpu) this.cpuWindows.set(phase, cpu = { wall: new Float64Array(this.capacity), cpu: new Float64Array(this.capacity), cursor: 0, count: 0 });
      cpu.wall[cpu.cursor] = ms;
      cpu.cpu[cpu.cursor] = cpuMs;
      cpu.cursor = (cpu.cursor + 1) % this.capacity;
      cpu.count = Math.min(cpu.count + 1, this.capacity);
    }
    let window = this.windows.get(phase);
    if (!window) this.windows.set(phase, window = { values: new Float64Array(this.capacity), cursor: 0, count: 0,
      lifetime: { count: 0, total: 0, maximum: 0, above50: 0, above100: 0, buckets: new Float64Array(TIMING_BUCKET_LIMITS.length) } });
    window.values[window.cursor] = ms;
    window.cursor = (window.cursor + 1) % this.capacity;
    window.count = Math.min(window.count + 1, this.capacity);
    const lifetime = window.lifetime;
    lifetime.count++;
    lifetime.total += ms;
    lifetime.maximum = Math.max(lifetime.maximum, ms);
    if (ms > 50) lifetime.above50++;
    if (ms > 100) lifetime.above100++;
    lifetime.buckets[TIMING_BUCKET_LIMITS.findIndex(limit => ms <= limit)]++;
  }
  measure<T>(phase: RuntimePhase, run: () => T): T {
    if (!this.enabled) return run();
    const cpu = this.cpuNow(), started = performance.now();
    try { return run(); }
    finally {
      const wall = performance.now() - started, after = cpu === undefined ? undefined : this.cpuNow();
      this.record(phase, wall, after === undefined ? undefined : after - cpu!);
    }
  }
  /** Rolling wall/thread-CPU totals for phases that recorded CPU samples. */
  cpuSnapshot(): Partial<Record<RuntimePhase, CpuSummary>> {
    const result: Partial<Record<RuntimePhase, CpuSummary>> = {};
    for (const [phase, window] of this.cpuWindows) {
      let wall = 0, cpu = 0;
      for (let i = 0; i < window.count; i++) { wall += window.wall[i]; cpu += window.cpu[i]; }
      result[phase] = cpuSummary(window.count, wall, cpu);
    }
    return result;
  }
  /** Wall only: an await overlaps other work on this thread, so a thread-CPU
   * difference across it is not this phase's cost. */
  async measureAsync<T>(phase: RuntimePhase, run: () => Promise<T>): Promise<T> {
    if (!this.enabled) return run();
    const started = performance.now();
    try { return await run(); }
    finally { this.record(phase, performance.now() - started); }
  }
  snapshot(): Partial<Record<RuntimePhase, TimingSummary>> {
    const result: Partial<Record<RuntimePhase, TimingSummary>> = {};
    for (const [phase, window] of this.windows) {
      const values = Array.from(window.values.subarray(0, window.count)).sort((a, b) => a - b);
      result[phase] = { samples: values.length, mean: values.reduce((n, v) => n + v, 0) / values.length,
        p95: values[Math.ceil(values.length * 0.95) - 1], p99: values[Math.ceil(values.length * 0.99) - 1], maximum: values[values.length - 1] };
    }
    return result;
  }
  lifetimeSnapshot(): Partial<Record<RuntimePhase, LifetimeTimingSummary>> {
    const result: Partial<Record<RuntimePhase, LifetimeTimingSummary>> = {};
    for (const [phase, { lifetime }] of this.windows)
      result[phase] = { samples: lifetime.count, mean: lifetime.total / lifetime.count,
        maximum: lifetime.maximum, above50Ms: lifetime.above50, above100Ms: lifetime.above100,
        buckets: TIMING_BUCKET_LIMITS.map((limit, index) => ({ upperMs: Number.isFinite(limit) ? limit : null, samples: lifetime.buckets[index] })) };
    return result;
  }
  get retainedBytes(): number {
    return (this.windows.size * (this.capacity + TIMING_BUCKET_LIMITS.length) + this.cpuWindows.size * 2 * this.capacity) * Float64Array.BYTES_PER_ELEMENT;
  }
}

export interface ThreadCpuWindowSummary extends CpuSummary {
  windowTicks: number;
  /** Simulated ticks covered by this summary. */
  ticks: number;
  /** False while the first window is still filling. */
  complete: boolean;
}

/** Thread CPU against wall time per CPU_WINDOW_TICKS simulated ticks. Reports
 * the last complete window (or the partial first one), so a contended host is
 * visible next to the wall timings (I-0). Never part of a checkpoint. */
export class ThreadCpuWindow {
  private current = { ticks: 0, samples: 0, wall: 0, cpu: 0 };
  private last?: { ticks: number; samples: number; wall: number; cpu: number };
  constructor(readonly windowTicks = CPU_WINDOW_TICKS) {
    if (!Number.isInteger(windowTicks) || windowTicks < 1) throw new Error("Invalid CPU window");
  }
  add(ticks: number, wallMs: number, cpuMs: number | undefined): void {
    if (!Number.isInteger(ticks) || ticks < 0 || !Number.isFinite(wallMs) || wallMs < 0 || !validCpu(cpuMs)) return;
    const current = this.current;
    current.ticks += ticks; current.samples++; current.wall += wallMs; current.cpu += cpuMs;
    if (current.ticks >= this.windowTicks) { this.last = current; this.current = { ticks: 0, samples: 0, wall: 0, cpu: 0 }; }
  }
  snapshot(): ThreadCpuWindowSummary | undefined {
    const window = this.last ?? (this.current.samples ? this.current : undefined);
    if (!window) return undefined;
    return { ...cpuSummary(window.samples, window.wall, window.cpu), windowTicks: this.windowTicks, ticks: window.ticks, complete: window === this.last };
  }
}

/** Pauses reset the observation anchor, never the accumulated active time.
 * This is coordinator observation, excluded from authoritative checkpoints. */
export class RuntimeProgress {
  private anchor?: { tick: number; at: number };
  private simulatedMs = 0;
  private wallMs = 0;
  constructor(private readonly tickMs: number) {
    if (!Number.isFinite(tickMs) || tickMs <= 0) throw new Error("Invalid diagnostic tick duration");
  }
  reset(tick: number, at: number): void {
    this.anchor = Number.isSafeInteger(tick) && tick >= 0 && Number.isFinite(at) ? { tick, at } : undefined;
  }
  record(tick: number, at: number): void {
    if (!Number.isSafeInteger(tick) || !Number.isFinite(at)) return;
    const previous = this.anchor;
    if (!previous || tick < previous.tick || at < previous.at) { this.reset(tick, at); return; }
    this.simulatedMs += (tick - previous.tick) * this.tickMs;
    this.wallMs += at - previous.at;
    this.reset(tick, at);
  }
  snapshot() {
    return { simulatedMs: this.simulatedMs, wallMs: this.wallMs,
      ratio: this.wallMs > 0 ? this.simulatedMs / this.wallMs : undefined };
  }
}

export interface RuntimeCorrelation {
  matchId: string;
  runtimeId: string;
  source: string;
  runtime: string;
  threadId: number;
  tick: number;
  captureSequence: number;
}

export interface MatchDiagnostics {
  correlation?: RuntimeCorrelation;
  tick: number;
  timings: Partial<Record<RuntimePhase, TimingSummary>>;
  lifetimeTimings?: Partial<Record<RuntimePhase, LifetimeTimingSummary>>;
  retainedBytes: number;
  commands: number;
  ticksAdvanced: number;
  payloadBytes: number;
  replication?: { pending: number; skipped: number; encoderMemory?: { heapUsed: number; external: number; arrayBuffers: number };
    encoderTimings?: Partial<Record<RuntimePhase, TimingSummary>>; encoderRetainedBytes?: number; encoderFailureCause?: string; encodedTick?: number;
    baselineCache?: {hits: number; misses: number; retainedBytes: number};
    extraction?: {squadReads: number; shipReads: number; buildingReads: number; resourceReads: number; entityFallbacks: number; barrierReads?: number} };
  entities: { squads: number; ships: number; buildings: number; traders: number; projectiles: number; recruitment: number };
  planner: { pending: number; oldestAge: number; limited: number; workspaceBytes: number; workspaceUsed: number; receipts: number;
    preparation?: { pending: number; work: number; completed: number; rejected: number; restarts: number; coalesced: number; superseded: number; discardedWork: number };
    work?: number; completed?: number; superseded?: number; admissionDeferred?: number;
    cohorts?: PlannerCohort[]; };
  paths?: { land: PathResidency; water: PathResidency; amphibious?: PathResidency };
  domainWork?: { spatial?: { rebuilds: number; rows: number; hits: number };
    trade?: { spawnActorReads: number; quotaActorReads: number; playerReads: number; spawned: number; routeRequests: number; routeHits: number; marketReads: number } };
  /** Thread CPU of the simulation step against its wall time (I-0). */
  cpu?: ThreadCpuWindowSummary;
  /** RSS is shared process memory; the other fields are current worker usage.
   * heapUsed includes garbage. liveHeapBytes is heapUsed straight after a full
   * collection, present only when the host exposes gc (--expose-gc). */
  memory: { heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; processRss: number;
    liveHeapBytes?: number; liveHeapTick?: number };
}

export const PLANNER_CALLERS = ["navigation", "admission", "ship-admission", "army", "trade", "shore", "defense", "other", "strategy"] as const;
export type PlannerCaller = (typeof PLANNER_CALLERS)[number];
export interface PlannerCohort {
  playerId: number; caller: PlannerCaller; pending: number; oldestAge: number;
  active?: number; oldestActiveAge?: number; reclaiming?: number;
  work: number; complete: number; unreachable: number; limited: number; superseded: number;
}
export interface PathResidency {
  routes: number; routeTiles: number; routeBytes: number;
  /** False while a deferred (amphibious) hierarchy has not been needed. */
  hierarchyBuilt?: boolean;
  hierarchy: { clusters: number; portals: number; startTrees: number; treeBytes: number };
}
