export const RUNTIME_PHASES = [
  "setup", "economy", "ai", "ships", "routing", "movement", "combat",
  "capture", "transport", "cleanup", "tick", "queue", "commands",
  "snapshot", "encoding", "advance",
  "validation", "admission", "scheduler", "extraction", "pack", "json",
  "bufferCopy", "compression", "hash", "base64", "transfer", "fanout", "socket",
  "decode", "decompression", "unpack", "apply", "projection", "hud",
  "frame", "frameInterval", "presentation", "recovery", "gc",
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

/** Bounded diagnostic history only. These clocks never feed gameplay or
 * planner budgets and are deliberately excluded from world checkpoints. */
export class RuntimeDiagnostics {
  private readonly windows = new Map<RuntimePhase, { values: Float64Array; cursor: number; count: number;
    lifetime: { count: number; total: number; maximum: number; above50: number; above100: number; buckets: Float64Array } }>();
  constructor(readonly capacity = 256, readonly enabled = true) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096) throw new Error("Invalid diagnostic window");
  }
  record(phase: RuntimePhase, ms: number): void {
    if (!this.enabled || !Number.isFinite(ms) || ms < 0 || !RUNTIME_PHASES.includes(phase)) return;
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
    const started = performance.now();
    try { return run(); }
    finally { this.record(phase, performance.now() - started); }
  }
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
  get retainedBytes(): number { return this.windows.size * (this.capacity + TIMING_BUCKET_LIMITS.length) * Float64Array.BYTES_PER_ELEMENT; }
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
  paths?: { land: PathResidency; water: PathResidency };
  domainWork?: { spatial?: { rebuilds: number; rows: number; hits: number };
    trade?: { spawnActorReads: number; quotaActorReads: number; playerReads: number; spawned: number; routeRequests: number; routeHits: number; marketReads: number } };
  /** RSS is shared process memory; the other fields are current worker usage. */
  memory: { heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; processRss: number };
}

export const PLANNER_CALLERS = ["navigation", "admission", "ship-admission", "army", "trade", "shore", "defense", "other", "strategy"] as const;
export type PlannerCaller = (typeof PLANNER_CALLERS)[number];
export interface PlannerCohort {
  playerId: number; caller: PlannerCaller; pending: number; oldestAge: number;
  work: number; complete: number; unreachable: number; limited: number; superseded: number;
}
export interface PathResidency {
  routes: number; routeTiles: number; routeBytes: number;
  hierarchy: { clusters: number; portals: number; startTrees: number; treeBytes: number };
}
