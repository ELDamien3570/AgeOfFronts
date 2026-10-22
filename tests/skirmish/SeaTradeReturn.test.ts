import { seaReversePrefix } from "../../src/skirmish/domain/SeaTradeVoyages";
import { VESSELS } from "../../src/skirmish/content/Units";
import { describe, expect, it } from "vitest";
import { seaFleet } from "./SeaTradeFixture";
describe("physical sea returns", () => {
  it("matches independently reversed visited prefixes in both orientations", () => {
    for (let length = 1; length <= 100; length++) for (const reverse of [false, true]) for (let reached = 0; reached < length; reached++) {
      const path = Array.from({ length }, (_, i) => reverse ? length - 1 - i : i);
      const leg = { laneId: 1, reverse, next: reached + 1, end: length - 1, goalTile: path[length - 1] };
      const span = seaReversePrefix(leg, length, path[0]);
      const actual = Array.from({ length: span.end - span.next + 1 }, (_, i) => span.reverse ? length - 1 - span.next - i : span.next + i);
      expect(actual).toEqual(path.slice(0, reached + 1).reverse());
    }
  });
  it("reverses an interrupted prefix without teleporting or searching a return", () => {
    const f = seaFleet();
    for (let i = 0; i < 120 && !f.trade.actors.some(a => a.cargo > 0 && a.x > 20 * f.FIXED); i++) f.step();
    const actor = f.trade.actors.find(a => a.cargo > 0)!;
    expect(actor).toBeDefined(); const voyage = f.trade.seaTrade!.voyages.get(actor.id)!;
    // A continuation owns a hard trail pin, never a soft source departure slot.
    const saved = f.trade.seaTrade!.routes.checkpoint();
    const access = f.trade.seaTrade!.ports.access(f.ports[0], 1);
    for (const [key, ids] of saved.sourceRetention) if (key.startsWith(`1:${f.ports[0].tile}:`)) for (const id of ids) {
      const lane = saved.lanes.find(row => row.id === id)!;
      expect(access.includes(lane.key.lo) || access.includes(lane.key.hi)).toBe(true);
    }

    expect(voyage.leg!.next).toBeGreaterThan(2);
    const use = { ...voyage.leg! }, lastReached = f.trade.seaTrade!.routes.tile(use, Math.max(0, use.next - 1));
    const before = { x: actor.x, y: actor.y, cargo: actor.cargo, gold: f.trade.deliveredGold[1] ?? 0 };
    const requests = f.trade.seaTrade!.routes.diagnostics.accepted;
    f.game.removeBuilding(f.receivers[0].id); f.step();
    expect(actor.x).toBe(before.x); expect(actor.y).toBe(before.y);
    expect(voyage.returnSpans).toBeDefined();
    expect(f.trade.seaTrade!.nextWaypoint(actor)).toBe(lastReached);
    for (let i = 0; i < 400 && actor.state !== "loading"; i++) {
      const x = actor.x, y = actor.y; f.step();
      expect(Math.hypot(actor.x - x, actor.y - y)).toBeLessThanOrEqual(176);
    }
    expect(actor.state).toBe("loading"); expect(actor.cargo).toBe(0);
    expect(actor.returned).toBe(before.cargo); expect(f.trade.deliveredGold[1] ?? 0).toBe(before.gold);
    expect(f.trade.seaTrade!.routes.diagnostics.accepted).toBe(requests);
  });
  it("completes multiple outward legs then follows the pinned reverse sequence without intermediate payouts", () => {
    const f = seaFleet(1, 2);
    f.expansion.progression.states[1].completed.push(...VESSELS.filter(v => v.kind === "trade").map(v => v.technologyId));
    f.expansion.supply.goods.set(f.ports[0].id, 100000);
    // Another merchant discovers the foreign-to-foreign geometry at its own
    // departure; our paid continuation must reuse it rather than search anew.
    f.expansion.progression.states[2].completed.push(...VESSELS.filter(v => v.kind === "trade").map(v => v.technologyId));
    f.expansion.supply.goods.set(f.receivers[0].id, 100000);
    for (let i = 0; i < 1600 && ![...f.trade.seaTrade!.voyages.values()].some(v => v.trail.length >= 2); i++) f.step();
    const actor = f.trade.actors.find(a => (f.trade.seaTrade!.voyages.get(a.id)?.trail.length ?? 0) >= 2)!;
    expect(actor).toBeDefined(); const voyage = f.trade.seaTrade!.voyages.get(actor.id)!;
    // A continuation owns a hard trail pin, never a soft source departure slot.
    const saved = f.trade.seaTrade!.routes.checkpoint();
    const access = f.trade.seaTrade!.ports.access(f.ports[0], 1);
    for (const [key, ids] of saved.sourceRetention) if (key.startsWith(`1:${f.ports[0].tile}:`)) for (const id of ids) {
      const lane = saved.lanes.find(row => row.id === id)!;
      expect(access.includes(lane.key.lo) || access.includes(lane.key.hi)).toBe(true);
    }

    f.trade.seaTrade!.startReturn(actor);
    const spans = voyage.returnSpans;
    if (spans) expect(spans.map(span => span.laneId)).toEqual([...voyage.trail].reverse().map(use => use.laneId));
    const gold = f.trade.deliveredGold[1], requests = f.trade.seaTrade!.routes.diagnostics.accepted;
    const visited = actor.visited.slice();
    for (let i = 0; i < 600 && actor.state !== "loading"; i++) f.step();
    expect(actor.state).toBe("loading"); expect(actor.visited).toEqual(visited);
    // Other couriers may deliver, so this shipment's trip credit is the authority.
    expect(actor.tripGold).toBeDefined(); expect(f.trade.deliveredGold[1]).toBeGreaterThanOrEqual(gold);
    expect(f.trade.seaTrade!.routes.diagnostics.accepted).toBe(requests);
  });
});
