import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { RuntimeDiagnostics, type RuntimePhase } from "../../src/skirmish/RuntimeDiagnostics";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { PlanningWorkspace } from "../../src/skirmish/PlanningWorkspace";
import { decodeState, encodeState, type StateDecodeStats } from "../../src/skirmish/multiplayer/StateCodec";
import { SNAPSHOT_STATE_LIMITS, STATE_LIMITS } from "../../src/skirmish/multiplayer/StateLimits";
import { computeRuntimeBuild } from "../../src/skirmish/multiplayer/infrastructure/RuntimeBuild";

type Memory = ReturnType<typeof process.memoryUsage>;
class MemoryObserver extends RuntimeDiagnostics {
  private stage: RuntimePhase | "idle" = "idle";
  private readonly peaks = new Map<string, Memory>();
  sample() {
    const memory = process.memoryUsage(), previous = this.peaks.get(this.stage);
    this.peaks.set(this.stage, previous ? { rss: Math.max(previous.rss, memory.rss), heapUsed: Math.max(previous.heapUsed, memory.heapUsed),
      heapTotal: Math.max(previous.heapTotal, memory.heapTotal), external: Math.max(previous.external, memory.external),
      arrayBuffers: Math.max(previous.arrayBuffers, memory.arrayBuffers) } : memory);
  }
  override measure<T>(phase: RuntimePhase, run: () => T): T {
    const previous = this.stage; this.stage = phase;
    try { return super.measure(phase, run); } finally { this.sample(); this.stage = previous; }
  }
  override async measureAsync<T>(phase: RuntimePhase, run: () => Promise<T>): Promise<T> {
    const previous = this.stage; this.stage = phase;
    try { return await super.measureAsync(phase, run); } finally { this.sample(); this.stage = previous; }
  }
  snapshotMemory() { return Object.fromEntries(this.peaks); }
}

// One fixed ordinary local fixture, six sequential consumer cycles, no sockets,
// concurrency/capacity traffic, target hardware access or changed production flags.
const width = 128, height = 96, seed = 47;
const options = { seed, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" as const, deferredPlanning: true };
const match = new Skirmish(createSkirmishMap(width, height, new Uint8Array(width * height).fill(133)), options);
const arena = new PlanningWorkspace();
const anchor = arena.allocate(10, 0, -1, 100)!;
arena.allocate(11, 2, anchor, 102);
const squad = match.squads.find(unit => unit.playerId === 1)!;
match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: match.map.ref(100, 70) } });
match.step();
const observer = new MemoryObserver(), before = process.memoryUsage();
const sampler = setInterval(() => observer.sample(), 5);
const observations: { kind: string; cycle: number; payloadChars: number; stats: StateDecodeStats; after: Memory }[] = [];
try {
  for (const kind of ["snapshot", "checkpoint", "active-arena"] as const) {
    const value = kind === "snapshot" ? new SnapshotEncoder(true).encode(match.snapshot(false))
      : kind === "checkpoint" ? match.checkpoint() : arena.checkpoint();
    const limits = kind === "snapshot" ? SNAPSHOT_STATE_LIMITS : STATE_LIMITS;
    for (let cycle = 0; cycle < 6; cycle++) {
      const packet = await encodeState(value, observer, limits);
      let stats: StateDecodeStats | undefined;
      await decodeState(packet, { ...limits, diagnostics: observer, onDecoded: decoded => { stats = decoded; } });
      observations.push({ kind, cycle, payloadChars: packet.payload.length, stats: stats!, after: process.memoryUsage() });
    }
  }
} finally { clearInterval(sampler); }
const directory = join(process.cwd(), "Optimization Handoff", "Evidence");
mkdirSync(directory, { recursive: true });
const path = join(directory, "02-consumer-memory.json");
writeFileSync(path, JSON.stringify({ sourceBase: "14fafeb", runtimeId: computeRuntimeBuild(),
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  fixture: { width, height, options, tick: match.tick, squads: match.squads.length, ships: match.ships.length,
    buildings: match.buildings.length, plannerUsed: match.routePlanner.diagnostics.workspaceUsed,
    arenaCapacity: arena.capacity, arenaUsed: arena.used },
  before, sampledPeaks: observer.snapshotMemory(), timings: observer.snapshot(), observations,
  limits: { generic: STATE_LIMITS, snapshot: SNAPSHOT_STATE_LIMITS },
  qualification: "Sampled local observations only; not exact transient maxima, GC convergence, ARM, browser or target-capacity certification." }, null, 2) + "\n");
process.stdout.write(path + "\n");
