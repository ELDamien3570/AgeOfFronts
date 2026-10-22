import { describe, expect, it } from "vitest";
import { seaFleet } from "./SeaTradeFixture";
describe("shared-lane real simulation fleet", () => {
  it("launches, pays, physically returns and reuses its lane through the actual adapter", () => {
    const f = seaFleet();
    // Ninety water tiles require two movement updates per tile at Stone speed,
    // in each direction, plus initial waypoint and handling updates.
    for (let i = 0; i < 600 && f.trade.seaTrade!.diagnostics.cycles === 0; i++) f.step();
    expect(f.trade.seaTrade!.diagnostics.departures).toBeGreaterThan(0);
    expect(f.trade.deliveredGold[1]).toBeGreaterThan(0);
    expect(f.trade.seaTrade!.diagnostics.cycles).toBeGreaterThan(0);
    expect(f.trade.actors.every(actor => !actor.naval || actor.path.length === 0 && actor.nextPathIndex === 0)).toBe(true);
    expect(f.trade.seaTrade!.routes.diagnostics.accepted).toBeLessThan(5);
  });
  it("attaches more than forty eligible ready sources without a management queue", () => {
    const f = seaFleet(48, 48);
    // Match receiving capacity to the 48 productive sources so this checks
    // routing admission, rather than a single port's legitimate intake cap.
    f.receivers.forEach((receiver, i) => f.game.updateBuilding(receiver.id, { tile: f.game.map.ref(10 + i * 4, 50) }));
    const seen = new Set<number>();
    for (let tick = 0; tick < 700; tick++) {
      for (const port of f.ports) f.expansion.supply.goods.set(port.id, 1000);
      const before = new Map(f.trade.actors.map(actor => [actor.id, actor.shipmentId]));
      f.step();
      // Handling may finish and commit in this same phase. Observe actual
      // shipment changes instead of missing them with a pre-tick wait sample.
      for (const actor of f.trade.actors) if (actor.naval && actor.playerId === 1 &&
        actor.shipmentId !== (before.get(actor.id) ?? 0)) seen.add(actor.originTile);
      expect(f.trade.seaTrade!.diagnostics.readyAttachChecks).toBeLessThanOrEqual(8 * f.trade.actors.length);
    }
    expect(seen.size).toBeGreaterThan(40);
    // Drain the paid obligations, then restart all productive sources together.
    // Existing ready geometry must carry a synchronized wave larger than the
    // whole management budget, with management service completely disabled.
    f.trade.setPaused(1, true, true); f.step(700);
    expect(f.trade.actors.filter(actor => actor.playerId === 1 && actor.naval)).toHaveLength(0);
    f.trade.seaTrade!.stepManagement = () => 0; f.trade.setPaused(1, true, false);
    let largestWave = 0;
    for (let tick = 0; tick < 100; tick++) {
      for (const port of f.ports) f.expansion.supply.goods.set(port.id, 1000);
      const before = new Map(f.trade.actors.map(actor => [actor.id, actor.shipmentId]));
      f.step();
      const committed = new Set(f.trade.actors.filter(actor => actor.naval && actor.playerId === 1 &&
        actor.shipmentId > 0 && actor.shipmentId !== (before.get(actor.id) ?? 0)).map(actor => actor.originTile));
      largestWave = Math.max(largestWave, committed.size);
    }
    expect(largestWave).toBeGreaterThan(40);
  });
  it("charges cold demand registration to management while actor updates only enqueue intent", () => {
    const f = seaFleet(48, 48);
    f.receivers.forEach((receiver, i) => f.game.updateBuilding(receiver.id, { tile: f.game.map.ref(10 + i * 4, 50) }));
    const service = f.trade.seaTrade!, management = service.stepManagement.bind(service);
    service.stepManagement = () => 0;
    f.step(32); // Discovery/actors run while no management work is allotted.
    service.stepManagement = management;
    const before = service.checkpoint();
    expect(before.demandOrder[0].length).toBeGreaterThan(40);
    expect(before.routes.lanes).toHaveLength(0);
    expect(f.trade.stepPlanning(1)).toBe(1);
    expect(f.trade.seaTrade!.routes.usage.records).toBe(1);
    expect(f.trade.actors.every(actor => actor.cargo === 0)).toBe(true);
    const registered = f.trade.seaTrade!.routes.usage.records;
    expect(f.trade.stepPlanning(8)).toBeLessThanOrEqual(8);
    expect(f.trade.seaTrade!.routes.usage.records - registered).toBeLessThanOrEqual(8);
  });
  it("keeps recurring ready voyages moving with management entirely paused", () => {
    const f = seaFleet(); f.step(500);
    const service = f.trade.seaTrade!, before = { ...service.diagnostics }, accepted = service.routes.diagnostics.accepted;
    service.stepManagement = () => 0;
    f.step(400);
    expect(service.diagnostics.departures).toBeGreaterThan(before.departures);
    expect(service.diagnostics.arrivals).toBeGreaterThan(before.arrivals);
    expect(service.diagnostics.cycles).toBeGreaterThan(before.cycles);
    expect(service.routes.diagnostics.accepted).toBe(accepted);
  });
  it("restores the actual planner/packing/voyage state and next ticks exactly", () => {
    const f = seaFleet(2, 2); f.step(24);
    const saved = f.game.checkpoint();
    const cold = new (f.game.constructor as typeof import("../../src/skirmish/Simulation").Skirmish)(f.map(), f.options);
    cold.restore(saved);
    expect(cold.checkpoint()).toEqual(saved);
    for (let i = 0; i < 80; i++) { f.game.step(); cold.step(); expect(cold.checkpoint()).toEqual(f.game.checkpoint()); }
  });
});
