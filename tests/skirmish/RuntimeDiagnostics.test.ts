import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { RUNTIME_PHASES, RuntimeDiagnostics, RuntimeProgress } from "../../src/skirmish/RuntimeDiagnostics";
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
    expect(diagnostics.retainedBytes).toBeLessThanOrEqual(RUNTIME_PHASES.length * 3 * 8);
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
    expect(d.retainedBytes).toBe(32);
    for (const phase of RUNTIME_PHASES) for (let i = 0; i < 100; i++) d.record(phase, i);
    expect(d.retainedBytes).toBe(RUNTIME_PHASES.length * 4 * 8);
    expect(Object.values(d.snapshot()).every(s => s.samples === 4)).toBe(true);
    expect(() => new RuntimeDiagnostics(0)).toThrow();
  });
  it("observes every simulation stage without changing deterministic checkpoints", () => {
    const make = () => {
      const cells = new Uint8Array(64 * 48).fill(133);
      return new Skirmish(new GameMapImpl(64, 48, cells, cells.length), {
        seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true,
      });
    };
    const observed = make(), reference = make(), diagnostics = new RuntimeDiagnostics();
    observed.onPhase = (phase, ms) => diagnostics.record(phase, ms);
    const command = { type: "order" as const, playerId: 1,
      squadIds: observed.squads.filter(squad => squad.playerId === 1).map(squad => squad.id),
      order: { type: "move" as const, tile: observed.map.ref(40, 30) } };
    expect(diagnostics.measure("commands", () => observed.applyCommand(command))).toEqual(reference.applyCommand(command));
    for (let i = 0; i < 5; i++) { observed.step(); reference.step(); }
    expect(observed.checkpoint()).toEqual(reference.checkpoint());
    for (const phase of RUNTIME_PHASES.slice(0, 11)) expect(diagnostics.snapshot()[phase]?.samples).toBe(5);
    expect(diagnostics.snapshot().tick!.maximum).toBeGreaterThanOrEqual(0);
    const restored = make();
    restored.restore(observed.checkpoint());
    for (let i = 0; i < 10; i++) { observed.step(); restored.step(); }
    expect(observed.checkpoint()).toEqual(restored.checkpoint());
  });
});
