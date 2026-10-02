export const RUNTIME_PHASES = [
  "setup", "economy", "ai", "ships", "routing", "movement", "combat",
  "capture", "transport", "cleanup", "tick", "queue", "commands",
  "snapshot", "encoding", "advance",
] as const;
export type RuntimePhase = (typeof RUNTIME_PHASES)[number];
export interface TimingSummary { samples: number; mean: number; p95: number; p99: number; maximum: number }

/** Bounded diagnostic history only. These clocks never feed gameplay or
 * planner budgets and are deliberately excluded from world checkpoints. */
export class RuntimeDiagnostics {
  private readonly windows = new Map<RuntimePhase, { values: Float64Array; cursor: number; count: number }>();
  constructor(readonly capacity = 256) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096) throw new Error("Invalid diagnostic window");
  }
  record(phase: RuntimePhase, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0 || !RUNTIME_PHASES.includes(phase)) return;
    let window = this.windows.get(phase);
    if (!window) this.windows.set(phase, window = { values: new Float64Array(this.capacity), cursor: 0, count: 0 });
    window.values[window.cursor] = ms;
    window.cursor = (window.cursor + 1) % this.capacity;
    window.count = Math.min(window.count + 1, this.capacity);
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
  get retainedBytes(): number { return this.windows.size * this.capacity * Float64Array.BYTES_PER_ELEMENT; }
}

export interface MatchDiagnostics {
  tick: number;
  timings: Partial<Record<RuntimePhase, TimingSummary>>;
  retainedBytes: number;
  commands: number;
  ticksAdvanced: number;
  payloadBytes: number;
  entities: { squads: number; ships: number; buildings: number; traders: number; projectiles: number; recruitment: number };
  planner: { pending: number; oldestAge: number; limited: number; workspaceBytes: number; workspaceUsed: number; receipts: number };
  /** RSS is shared process memory; the other fields are current worker usage. */
  memory: { heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; processRss: number };
}
