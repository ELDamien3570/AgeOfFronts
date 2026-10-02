import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { RUNTIME_PHASES, RuntimeDiagnostics } from "../../src/skirmish/RuntimeDiagnostics";
import { Skirmish } from "../../src/skirmish/Simulation";

describe("bounded non-authoritative runtime diagnostics", () => {
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
    for (let i = 0; i < 5; i++) { observed.step(); reference.step(); }
    expect(observed.checkpoint()).toEqual(reference.checkpoint());
    for (const phase of RUNTIME_PHASES.slice(0, 11)) expect(diagnostics.snapshot()[phase]?.samples).toBe(5);
    expect(diagnostics.snapshot().tick!.maximum).toBeGreaterThanOrEqual(0);
  });
});
