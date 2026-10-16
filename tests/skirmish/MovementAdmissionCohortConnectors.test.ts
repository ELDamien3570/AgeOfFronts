import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { COHORT_CONNECTORS } from "../../src/skirmish/MovementAdmission";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { retainSquads } from "./UnitFixtures";

/** D2 (R2-P3, notes 16 rec 2): one planner job per cohort. Short moves and
 * the entry/exit connectors of spine members are planned by a bounded
 * synchronous search instead of one or two planner jobs per member. */
function fixture(count: number, width = 160, height = 90) {
  const data = new Uint8Array(width * height).fill(133);
  const map = new GameMapImpl(width, height, data, data.length);
  const match = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true });
  const template = match.squads.find(s => s.playerId === 1)!;
  const squads = retainSquads(match, Array.from({ length: count }, (_, i) => ({
    ...template, id: match.allocateId(), playerId: 1,
    x: Math.round((8.5 + (i % 6) * 2.5) * FIXED), y: Math.round((20.5 + Math.floor(i / 6) * 2.5) * FIXED),
    order: { type: "hold" as const }, path: [], queuedOrders: [],
  })));
  const admissionRequests: string[] = [];
  const request = match.routePlanner.request.bind(match.routePlanner);
  match.routePlanner.request = (r) => {
    if (r.key.startsWith("admission:")) admissionRequests.push(r.key);
    return request(r);
  };
  return { map, match, squads, admissionRequests };
}
const contiguous = (map: GameMapImpl, path: readonly number[]) =>
  path.every((tile, i) => !i || Math.max(Math.abs(map.x(tile) - map.x(path[i - 1])), Math.abs(map.y(tile) - map.y(path[i - 1]))) <= 1);
function move(match: Skirmish, squads: readonly Squad[], tile: number) {
  const outcome = match.commandApplications.apply("move", { type: "order", playerId: 1, squadIds: squads.map(s => s.id), order: { type: "move", tile } });
  expect(outcome.status).not.toBe("rejected");
}
function settle(match: Skirmish, squads: readonly Squad[], limit = 40): number {
  for (let tick = 1; tick <= limit; tick++) {
    match.step();
    if (squads.every(s => !match.movementAdmission.hasPending(s.id) && match.squad(s.id)!.order.type === "move")) return tick;
  }
  return Infinity;
}

describe("cohort connectors (D2)", () => {
  it("commits a short 30-squad move without a planner job per member", () => {
    const { map, match, squads, admissionRequests } = fixture(30);
    move(match, squads, map.ref(30, 30));
    const ticks = settle(match, squads);
    expect(ticks).toBeLessThanOrEqual(8);
    // Before D2 each member filed its own exact job (30 or more).
    expect(admissionRequests.length).toBeLessThanOrEqual(4);
    expect(match.movementAdmission.connectorDiagnostics.synchronous).toBeGreaterThanOrEqual(26);
    for (const s of squads) {
      const live = match.squad(s.id)!;
      expect(contiguous(map, live.path)).toBe(true);
    }
  });

  it("shares one corridor job across a long move and plans connectors synchronously", () => {
    const { map, match, squads, admissionRequests } = fixture(30);
    move(match, squads, map.ref(120, 60));
    const ticks = settle(match, squads, 120);
    expect(ticks).toBeLessThan(Infinity);
    // One lead route per selection (plus, at most, one per cohort); no per-member jobs.
    expect(admissionRequests.length).toBeLessThanOrEqual(4);
    for (const s of squads) {
      const live = match.squad(s.id)!;
      expect(live.path.length).toBeGreaterThan(40);
      expect(contiguous(map, live.path)).toBe(true);
    }
  });

  it("keeps step() within its budget and the synchronous work within the tick budget", () => {
    const { map, match, squads } = fixture(30);
    move(match, squads, map.ref(30, 30));
    const admission = match.movementAdmission;
    let previous = admission.connectorDiagnostics.work;
    for (let tick = 0; tick < 6; tick++) {
      for (const budget of [1, 3, 7]) expect(admission.stepInteractive(match.tick, budget)).toBeLessThanOrEqual(budget);
      expect(admission.step(match.tick, 5)).toBeLessThanOrEqual(5);
      const spent = admission.connectorDiagnostics.work - previous;
      // One search may start below the budget and finish above it, never more.
      expect(spent).toBeLessThanOrEqual(COHORT_CONNECTORS.tickBudget + 2 * COHORT_CONNECTORS.expansionLimit);
      previous = admission.connectorDiagnostics.work;
      match.step();
    }
  });

  it("restores a half-admitted selection to the same outcome", () => {
    const run = (restoreAt?: number) => {
      const { map, match, squads } = fixture(30);
      move(match, squads, map.ref(120, 60));
      for (let tick = 1; tick <= 30; tick++) {
        if (tick === restoreAt) {
          const saved = match.checkpoint(), copy = fixture(30).match;
          copy.restore(saved);
          return { squads: squads.map(s => copy.squad(s.id)), copy, rest: 30 - tick + 1 };
        }
        match.step();
      }
      return { squads: squads.map(s => match.squad(s.id)), copy: match, rest: 0 };
    };
    const straight = run();
    const restored = run(1);
    for (let i = 0; i < restored.rest; i++) restored.copy.step();
    expect(restored.squads.map(s => restored.copy.squad(s!.id)!.path)).toEqual(straight.squads.map(s => s!.path));
  });
});
