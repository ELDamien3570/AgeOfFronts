/**
 * Opt-in routing micro-benchmarks for roadmap Next #1 (R2-P6, R2-P2, D5).
 * Timing gates are meaningless on a contended host, so the whole file is
 * skipped unless SKIRMISH_PERF=1:
 *
 *   SKIRMISH_PERF=1 npx vitest run --config vite.skirmish.config.ts tests/skirmish/perf/RoutingMicro.perf.test.ts
 */
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../../src/core/game/GameMap";
import { MovementAdmission } from "../../../src/skirmish/MovementAdmission";
import { FIXED } from "../../../src/skirmish/Protocol";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { retainSquads } from "../UnitFixtures";

const enabled = process.env.SKIRMISH_PERF === "1";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe.runIf(enabled)("routing micro-benchmarks (opt-in)", () => {
  it("B1: one priority admission pass over P=500 pending, humans waiting on the planner, under 1 ms", () => {
    const width = 160, height = 120, data = new Uint8Array(width * height).fill(133);
    const map = new GameMapImpl(width, height, data, data.length);
    const match = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true });
    const template = match.squads.find(s => s.playerId === 1)!;
    const P = 500;
    // One human admission in ten, as in the reviewer's spread benchmark.
    const squads = retainSquads(match, Array.from({ length: P }, (_, i) => ({
      ...template, id: match.allocateId(), playerId: i % 10 === 0 ? 1 : 2,
      x: Math.round((4.5 + (i % 25) * 2) * FIXED), y: Math.round((4.5 + Math.floor(i / 25) * 2) * FIXED),
      order: { type: "hold" as const }, path: [], queuedOrders: [],
    })));
    const admission = new MovementAdmission(map, match.paths, {
      squads: () => match.squads, priority: playerId => playerId === 1, squad: id => match.squad(id),
      generation: () => 0, revision: () => "0", blocked: () => undefined,
      // Every search is accepted and never completes: admissions wait on the planner.
      request: () => true,
      cancel: () => {}, queue: () => {}, clear: () => true, destinationValid: () => true, commit: () => {},
    });
    for (const squad of squads) admission.start(squad.playerId, [squad], map.ref(100 + (squad.id % 50), 10 + (squad.id % 100)), 0);
    expect(admission.pendingCount).toBe(P);
    // Finish formation planning and issue every leader's request.
    for (let tick = 0; tick < 400; tick++) admission.step(tick, 4096);
    const phases = admission.checkpoint().pending.map(([, a]) => a.phase);
    expect(phases.every(p => p === "routes")).toBe(true);
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      admission.stepInteractive(400 + i, 320);
      samples.push(performance.now() - t0);
    }
    console.log(`B1 stepInteractive P=${P}: median ${median(samples).toFixed(3)} ms, max ${Math.max(...samples).toFixed(3)} ms`);
    expect(median(samples)).toBeLessThan(1);
  });
});
