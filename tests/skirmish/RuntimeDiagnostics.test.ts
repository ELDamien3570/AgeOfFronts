import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { CPU_WINDOW_TICKS, RUNTIME_PHASES, RuntimeDiagnostics, RuntimeProgress, ThreadCpuWindow, TIMING_BUCKET_LIMITS, WALL_PER_CPU_FLAG, threadCpuClock, type RuntimePhase } from "../../src/skirmish/RuntimeDiagnostics";
import { liveHeapBytes } from "../../src/skirmish/multiplayer/infrastructure/WorkerRuntimeDiagnostics";
import { decodeState, encodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { Skirmish } from "../../src/skirmish/Simulation";

describe("bounded non-authoritative runtime diagnostics", () => {
  it("observes codec stages without changing bytes, hashes or decoded values", async () => {
    const value = { data: new Uint16Array(8192).fill(17), text: "codec observation" };
    const diagnostics = new RuntimeDiagnostics(3);
    const reference = await encodeState(value);
    const observed = await encodeState(value, diagnostics);
    expect(observed).toEqual(reference);
    expect(await decodeState(observed, { diagnostics })).toEqual(value);
    for (const phase of ["pack", "json", "compression", "hash", "base64", "decompression", "unpack"] as const)
      expect(diagnostics.snapshot()[phase]?.samples).toBeGreaterThan(0);
    expect(diagnostics.retainedBytes).toBeLessThanOrEqual(RUNTIME_PHASES.length * (3 + TIMING_BUCKET_LIMITS.length) * 8);
  });
  it("keeps failed measurements and disabled observers outside execution semantics", async () => {
    const diagnostics = new RuntimeDiagnostics(2);
    const failure = new Error("actual operation failure");
    expect(() => diagnostics.measure("commands", () => { throw failure; })).toThrow(failure);
    await expect(diagnostics.measureAsync("encoding", async () => { throw failure; })).rejects.toBe(failure);
    expect(diagnostics.snapshot().commands?.samples).toBe(1);
    expect(diagnostics.snapshot().encoding?.samples).toBe(1);
    const disabled = new RuntimeDiagnostics(2, false);
    expect(disabled.measure("commands", () => 42)).toBe(42);
    expect(disabled.snapshot()).toEqual({});
    expect(disabled.retainedBytes).toBe(0);
  });
  it("excludes pauses and invalid clocks from the simulated versus wall time ratio", () => {
    const progress = new RuntimeProgress(50);
    expect(progress.snapshot().ratio).toBeUndefined();
    progress.reset(20, 1000);
    progress.record(24, 1250);
    expect(progress.snapshot()).toEqual({ simulatedMs: 200, wallMs: 250, ratio: 0.8 });
    progress.record(25, NaN);
    expect(progress.snapshot().ratio).toBe(0.8);
    progress.reset(24, 9000);
    progress.record(26, 9100);
    expect(progress.snapshot()).toEqual({ simulatedMs: 300, wallMs: 350, ratio: 300 / 350 });
    progress.record(25, 9200);
    expect(progress.snapshot().simulatedMs).toBe(300);
  });
  it("retains only the configured rolling samples and ignores invalid readings", () => {
    const d = new RuntimeDiagnostics(4);
    for (const value of [1, 2, 3, 4, 10]) d.record("tick", value);
    d.record("tick", NaN); d.record("tick", -1); d.record("tick", Infinity);
    expect(d.snapshot().tick).toEqual({ samples: 4, mean: 4.75, p95: 10, p99: 10, maximum: 10 });
    expect(d.retainedBytes).toBe((4 + TIMING_BUCKET_LIMITS.length) * 8);
    for (const phase of RUNTIME_PHASES) for (let i = 0; i < 100; i++) d.record(phase, i);
    expect(d.retainedBytes).toBe(RUNTIME_PHASES.length * (4 + TIMING_BUCKET_LIMITS.length) * 8);
    expect(Object.values(d.snapshot()).every(s => s.samples === 4)).toBe(true);
    expect(() => new RuntimeDiagnostics(0)).toThrow();
  });
  it("preserves whole-run tails after spikes leave the rolling window", () => {
    const d = new RuntimeDiagnostics(2);
    for (const ms of [0, 1, 50, 50.1, 100, 100.1, 1200, 2, 3]) d.record("tick", ms);
    d.record("tick", NaN);
    const whole = d.lifetimeSnapshot().tick!;
    expect(d.snapshot().tick).toMatchObject({ samples: 2, maximum: 3 });
    expect(whole).toMatchObject({ samples: 9, maximum: 1200, above50Ms: 4, above100Ms: 2 });
    expect(whole.mean).toBeCloseTo(1506.2 / 9);
    expect(whole.buckets.reduce((sum, bucket) => sum + bucket.samples, 0)).toBe(9);
    expect(whole.buckets[0].samples).toBe(2);
    expect(whole.buckets[whole.buckets.length - 1]).toEqual({ upperMs: null, samples: 1 });
    whole.buckets[0].samples = 500;
    expect(d.lifetimeSnapshot().tick!.buckets[0].samples).toBe(2);
  });
  it("observes every simulation stage without changing deterministic checkpoints", () => {
    const make = () => {
      const cells = new Uint8Array(64 * 48).fill(133);
      return new Skirmish(new GameMapImpl(64, 48, cells, cells.length), {
        seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true,
      });
    };
    const observed = make(), reference = make(), diagnostics = new RuntimeDiagnostics(256, true, threadCpuClock);
    let cpuAt = diagnostics.cpuNow();
    observed.onPhase = (phase, ms) => { const now = diagnostics.cpuNow(); diagnostics.record(phase, ms, now === undefined || cpuAt === undefined ? undefined : now - cpuAt); cpuAt = now; };
    const command = { type: "order" as const, playerId: 1,
      squadIds: observed.squads.filter(squad => squad.playerId === 1).map(squad => squad.id),
      order: { type: "move" as const, tile: observed.map.ref(40, 30) } };
    expect(diagnostics.measure("commands", () => observed.applyCommand(command))).toEqual(reference.applyCommand(command));
    for (let i = 0; i < 5; i++) { observed.step(); reference.step(); }
    expect(observed.checkpoint()).toEqual(reference.checkpoint());
    for (const phase of RUNTIME_PHASES.slice(0, 11)) expect(diagnostics.snapshot()[phase]?.samples).toBe(5);
    expect(diagnostics.snapshot().tick!.maximum).toBeGreaterThanOrEqual(0);
    // Node 24 exposes a per-thread clock: CPU rows exist and sim state is unchanged.
    expect(diagnostics.cpuSnapshot().tick?.samples).toBe(5);
    const restored = make();
    restored.restore(observed.checkpoint());
    for (let i = 0; i < 10; i++) { observed.step(); restored.step(); }
    expect(observed.checkpoint()).toEqual(restored.checkpoint());
  });
  it("samples thread CPU beside wall time and flags a contended host (I-0)", () => {
    // Injected clock: every read advances 10 ms of CPU, so each measure costs 10 ms.
    let cpu = 100;
    const d = new RuntimeDiagnostics(4, true, () => (cpu += 10));
    expect(d.measure("commands", () => 7)).toBe(7);
    d.record("simulate", 30, 20); d.record("simulate", 10, 10);
    const rows = d.cpuSnapshot();
    expect(rows.commands).toMatchObject({ samples: 1, threadMs: 10 });
    expect(rows.simulate).toEqual({ samples: 2, wallMs: 40, threadMs: 30, meanWallMs: 20, meanThreadMs: 15, wallPerCpu: 40 / 30, flagged: false });
    d.record("simulate", 50, 10);
    expect(d.cpuSnapshot().simulate).toMatchObject({ samples: 3, wallMs: 90, threadMs: 40, wallPerCpu: 2.25, flagged: true });
    // Exactly at the threshold is not flagged; above it is.
    const edge = new RuntimeDiagnostics(4);
    edge.record("simulate", WALL_PER_CPU_FLAG * 10, 10);
    expect(edge.cpuSnapshot().simulate!.flagged).toBe(false);
    edge.record("simulate", 1, 0);
    expect(edge.cpuSnapshot().simulate!.flagged).toBe(true);
    // Invalid CPU readings keep the wall sample and drop only the CPU part.
    const invalid = new RuntimeDiagnostics(4);
    for (const bad of [NaN, -1, Infinity]) invalid.record("simulate", 5, bad);
    expect(invalid.snapshot().simulate?.samples).toBe(3);
    expect(invalid.cpuSnapshot().simulate).toBeUndefined();
    expect(invalid.retainedBytes).toBe((4 + TIMING_BUCKET_LIMITS.length) * 8);
    const broken = new RuntimeDiagnostics(4, true, () => NaN);
    expect(broken.cpuNow()).toBeUndefined();
    broken.measure("commands", () => 0);
    expect(broken.cpuSnapshot()).toEqual({});
    // No clock (browser) and disabled instances record no CPU at all.
    expect(new RuntimeDiagnostics(4).cpuNow()).toBeUndefined();
    const disabled = new RuntimeDiagnostics(4, false, () => (cpu += 10));
    expect(disabled.cpuNow()).toBeUndefined();
    disabled.record("simulate", 5, 5);
    expect(disabled.cpuSnapshot()).toEqual({});
    expect(disabled.retainedBytes).toBe(0);
    // Rolling: only the configured number of paired samples is kept.
    const rolling = new RuntimeDiagnostics(2);
    for (const ms of [1, 2, 3]) rolling.record("simulate", ms, ms);
    expect(rolling.cpuSnapshot().simulate).toMatchObject({ samples: 2, wallMs: 5, threadMs: 5 });
    expect(rolling.retainedBytes).toBe((2 + TIMING_BUCKET_LIMITS.length + 2 * 2) * 8);
  });
  it("keeps ignoring unknown phases and lists the simulate phase", () => {
    const d = new RuntimeDiagnostics(4);
    d.record("not-a-phase" as RuntimePhase, 5, 5);
    expect(d.snapshot()).toEqual({});
    expect(d.cpuSnapshot()).toEqual({});
    expect(RUNTIME_PHASES).toContain("simulate");
  });
  it("reports thread CPU per 400-tick window with the wall/CPU flag", () => {
    expect(CPU_WINDOW_TICKS).toBe(400);
    const w = new ThreadCpuWindow(4);
    expect(w.snapshot()).toBeUndefined();
    w.add(1, 30, 20);
    expect(w.snapshot()).toMatchObject({ complete: false, ticks: 1, samples: 1, wallMs: 30, threadMs: 20, wallPerCpu: 1.5, flagged: false, windowTicks: 4 });
    w.add(3, 90, 20);
    expect(w.snapshot()).toMatchObject({ complete: true, ticks: 4, samples: 2, wallMs: 120, threadMs: 40, wallPerCpu: 3, flagged: true });
    // The next partial window does not replace the last complete one.
    w.add(1, 1, 1); w.add(1, 1, NaN); w.add(-1, 1, 1); w.add(1, -1, 1);
    expect(w.snapshot()).toMatchObject({ complete: true, ticks: 4, wallMs: 120 });
    w.add(3, 10, 10);
    expect(w.snapshot()).toMatchObject({ complete: true, ticks: 4, samples: 2, wallMs: 11, threadMs: 11, wallPerCpu: 1, flagged: false });
    expect(() => new ThreadCpuWindow(0)).toThrow();
  });
  it("measures live heap only when a gc function is exposed", () => {
    expect(liveHeapBytes(undefined)).toBeUndefined();
    let collected = 0;
    expect(liveHeapBytes(() => { collected++; }, () => ({ heapUsed: 1234 }))).toBe(1234);
    expect(collected).toBe(1);
  });
});
