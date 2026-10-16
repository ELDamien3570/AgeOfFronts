import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { ADMISSION_REFUSAL_BACKOFF, MovementAdmission } from "../../src/skirmish/MovementAdmission";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { retainSquads } from "./UnitFixtures";

function fixture(count: number) {
  const width = 100, height = 70, data = new Uint8Array(width * height).fill(133);
  const map = new GameMapImpl(width, height, data, data.length);
  const match = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true });
  const template = match.squads.find(s => s.playerId === 1)!;
  const squads = retainSquads(match, Array.from({ length: count }, (_, i) => ({
    ...template, id: match.allocateId(), playerId: 1,
    x: Math.round((5.5 + (i % 10) * 2) * FIXED), y: Math.round((5.5 + Math.floor(i / 10) * 2) * FIXED),
    order: { type: "hold" as const }, path: [], queuedOrders: [],
  })));
  return { map, match, squads };
}

describe("admission refusal back-off (P20)", () => {
  it("does not re-request a refused member before its back-off expires", () => {
    const { map, match, squads } = fixture(30);
    const calls: { tick: number; squadId: number }[] = [];
    let tick = 0, accept = false;
    const admission = new MovementAdmission(map, match.paths, {
      squads: () => match.squads, priority: () => true, squad: id => match.squad(id),
      generation: () => 0, revision: () => "0", blocked: () => undefined,
      request: (_id, _player, squadId) => { calls.push({ tick, squadId }); return accept; },
      cancel: () => {}, queue: () => {}, clear: () => true, destinationValid: () => true, commit: () => {},
    });
    // Ten single-member admissions; the planner refuses everything.
    for (const squad of squads.slice(0, 10)) admission.start(1, [squad], map.ref(70, 40 + (squad.id % 20)), 0);
    for (; tick < 64; tick++) {
      // Generous budgets: before P20 each refusal re-asked within the same tick.
      admission.stepInteractive(tick, 320);
      admission.step(tick, 128);
    }
    const bySquad = new Map<number, number[]>();
    for (const call of calls) bySquad.set(call.squadId, [...(bySquad.get(call.squadId) ?? []), call.tick]);
    expect(bySquad.size).toBe(10);
    for (const ticks of bySquad.values()) {
      // 2, 4, 8, then 16-tick gaps after consecutive refusals.
      const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
      expect(gaps.slice(0, 4)).toEqual([2, 4, 8, 16]);
      expect(gaps.every(g => g <= ADMISSION_REFUSAL_BACKOFF.maximumTicks)).toBe(true);
      expect(new Set(ticks).size).toBe(ticks.length);
    }
    // At most one request per member per tick under a saturated planner.
    const perTick = new Map<number, number>();
    for (const call of calls) perTick.set(call.tick, (perTick.get(call.tick) ?? 0) + 1);
    expect(Math.max(...perTick.values())).toBeLessThanOrEqual(10);
    // An accepted request clears the refusal streak.
    accept = true;
    const before = calls.length;
    for (; tick < 90 && calls.length - before < 10; tick++) { admission.stepInteractive(tick, 320); admission.step(tick, 128); }
    expect(calls.length - before).toBe(10);
    expect(admission.checkpoint().pending.every(([, a]) => a.members.every(m => m.requested && m.refusals === undefined))).toBe(true);
  });

  it("counts refusals in the checkpoint and restores them", () => {
    const { map, match, squads } = fixture(1);
    const make = () => new MovementAdmission(map, match.paths, {
      squads: () => match.squads, priority: () => true, squad: id => match.squad(id),
      generation: () => 0, revision: () => "0", blocked: () => undefined,
      request: () => false, cancel: () => {}, queue: () => {}, clear: () => true, destinationValid: () => true, commit: () => {},
    });
    const a = make();
    a.start(1, squads, map.ref(70, 40), 0);
    for (let tick = 0; tick < 12; tick++) a.step(tick, 128);
    const saved = a.checkpoint(), b = make();
    b.restore(saved);
    expect(b.checkpoint()).toEqual(saved);
    expect(saved.pending[0][1].members[0].refusals).toBeGreaterThan(1);
  });
});
