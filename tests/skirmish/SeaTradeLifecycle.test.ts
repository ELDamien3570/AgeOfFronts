import { describe, expect, it, vi } from "vitest";
import { Skirmish } from "../../src/skirmish/Simulation";
import { seaFleet } from "./SeaTradeFixture";
const launched = () => {
  const f = seaFleet();
  for (let i = 0; i < 80 && !f.trade.actors.some(actor => actor.cargo > 0 && actor.waitTicks === 0); i++) f.step();
  return { ...f, actor: f.trade.actors.find(actor => actor.cargo > 0 && actor.waitTicks === 0)! };
};
describe("sea voyage lifecycle", () => {
  it("uses authoritative indexed absence without scanning all buildings during discovery", () => {
    const f = seaFleet(), service = f.trade.seaTrade!;
    const component = f.game.waterPaths.component[f.game.map.ref(10, 40)];
    const view = service.ports.view(9000000, 1, f.ports[0].tile, component);
    service.ports.rememberSource(view, 9000001);
    expect(f.game.building(9000001)).toBeUndefined();
    const reads = vi.spyOn(f.game, "buildings", "get");
    try {
      expect(service.ports.candidates(view)).toEqual([]);
      expect(reads).not.toHaveBeenCalled();
    } finally { reads.mockRestore(); }
  });

  it("never starts cold geometry searches for optional extra stops", () => {
    const f = seaFleet(1, 2), acquisitions: boolean[] = [];
    f.trade.seaTrade!.routes.onEvent = event => {
      if (event.type === "acquire" && event.kind === "continuation") acquisitions.push(!!event.ready);
    };
    f.step(800);
    expect(f.trade.seaTrade!.diagnostics.arrivals).toBeGreaterThan(0);
    expect(f.trade.seaTrade!.diagnostics.cycles).toBeGreaterThan(0);
    expect(acquisitions).toEqual([]);
    expect(f.trade.seaTrade!.checkpoint().voyages.every(([, voyage]) => voyage.pending?.kind !== "continuation")).toBe(true);
  });
  it("captures a paid voyage and salvages once while normal trade is paused", () => {
    const f = launched(), actor = f.actor, value = actor.cargo * actor.valuePerGood;
    f.trade.setPaused(2, true, true);
    f.game.addShip({ id: f.game.allocateId(), playerId: 2, kind: "warship", definitionId: "stoneage-warship",
      x: actor.x, y: actor.y, health: 1000, destination: null, waypoints: [], path: [], nextPathIndex: 0, fighting: false });
    f.step(); expect(actor.state).toBe("prize"); expect(actor.playerId).toBe(2);
    expect(f.trade.capturedValue[2]).toBe(value);
    for (let i = 0; i < 500 && f.trade.actors.some(a => a.id === actor.id); i++) f.step();
    expect(f.trade.actors.some(a => a.id === actor.id)).toBe(false);
    expect(f.trade.deliveredGold[2]).toBe(value);
    const paid = f.trade.deliveredGold[2]; f.step(40); expect(f.trade.deliveredGold[2]).toBe(paid);
    expect(f.trade.seaTrade!.voyages.has(actor.id)).toBe(false);
    expect(f.trade.seaTrade!.routes.checkpoint().subscriptions.some(sub => sub.holder.type !== "source-demand" && sub.holder.actorId === actor.id)).toBe(false);
  });
  it("preserves a paid trail when trade is paused at a foreign stop", () => {
    const f = launched();
    for (let i = 0; i < 300 && f.actor.visited.length === 0; i++) f.step();
    const cargo = f.actor.cargo;
    f.trade.setPaused(1, true, true);
    for (let i = 0; i < 400 && f.actor.state !== "loading"; i++) f.step();
    // Paused idle actors can retire after completing the obligation.
    expect(f.actor.cargo).toBe(0); expect(f.actor.returned).toBe(cargo);
  });
  it("converts source loss into paid salvage without retaining the old trail", () => {
    const f = launched(), cargo = f.actor.cargo;
    const rescue = f.game.addBuilding({ ...f.ports[0], id: f.game.allocateId(), tile: f.game.map.ref(50, 39) });
    f.game.removeBuilding(f.ports[0].id); f.step();
    expect(f.actor).toMatchObject({ state: "prize", cargo });
    for (let i = 0; i < 300 && f.trade.actors.some(actor => actor.id === f.actor.id); i++) f.step();
    expect(f.trade.actors.some(actor => actor.id === f.actor.id)).toBe(false);
    expect(f.trade.deliveredGold[1]).toBe(cargo * f.actor.valuePerGood);
    expect(f.game.building(rescue.id)).toBeDefined();
  });
  it("keeps a source dispatch geometry stable during repeated incomplete discovery passes", () => {
    const f = seaFleet(1, 2); f.step(8);
    // Deny planner occupancy without generating false unreachable results.
    const request = f.game.routePlanner.request.bind(f.game.routePlanner);
    f.game.routePlanner.request = () => false;
    f.step(100);
    const saved = f.trade.seaTrade!.checkpoint();
    expect(saved.dispatches).toHaveLength(1);
    expect(saved.routes.lanes).toHaveLength(1);
    expect(saved.routes.lanes[0].firstDemandTick).toBeLessThan(20);
    expect(f.trade.actors.every(actor => actor.cargo === 0)).toBe(true);
    f.game.routePlanner.request = request;
    f.step(30); expect(f.trade.actors.some(actor => actor.cargo > 0)).toBe(true);
  });
});


describe("sea geometry survives changing intake", () => {
  it("waits for a known route's intake rather than searching an uncached alternative", () => {
    const f = seaFleet(), service = f.trade.seaTrade!; f.step(500);
    f.trade.setPaused(1, true, true); f.step(500);
    const receiver = f.receivers[0];
    f.game.addBuilding({ ...receiver, id: f.game.allocateId(), playerId: 3, tile: f.game.map.ref(30, 50) });
    const before = service.routes.diagnostics.requests;
    const intake = (service as any).world.intake;
    const blocked = vi.spyOn((service as any).world, "intake").mockImplementation((...args: unknown[]) =>
      (args[1] as {id:number}).id === receiver.id ? 0 : intake(...args));
    f.trade.setPaused(1, true, false);
    for (let i = 0; i < 64; i++) { f.expansion.supply.goods.set(f.ports[0].id, 1000); f.step(); }
    expect(service.routes.diagnostics.requests).toBe(before);
    expect(service.routes.usage.queued).toBe(0);
    expect(f.trade.actors.every(actor => actor.cargo === 0)).toBe(true);
    expect(f.trade.actors.some(actor => actor.waitDetail === "market-intake")).toBe(true);
    blocked.mockRestore(); f.step(80);
    expect(f.trade.actors.some(actor => actor.cargo > 0)).toBe(true);
  });
  it("keeps a selected source lane and its age while its intake repeatedly fills", () => {
    const f = seaFleet(1, 2), service = f.trade.seaTrade!;
    const request = f.game.routePlanner.request.bind(f.game.routePlanner);
    f.game.routePlanner.request = () => false;
    f.step(32);
    const original = service.checkpoint().dispatches[0][1];
    expect(original.laneId).toBeDefined();
    const intake = (service as any).world.intake;
    const blocked = vi.spyOn((service as any).world, "intake").mockImplementation((...args: unknown[]) =>
      (args[1] as {id:number}).id === original.receiverId ? 0 : intake(...args));
    f.step(24);
    const after = service.checkpoint().dispatches[0][1];
    expect(after).toMatchObject({ receiverId: original.receiverId, goalTile: original.goalTile, laneId: original.laneId, requestedTick: original.requestedTick });
    expect(service.routes.checkpoint().lanes).toHaveLength(1);
    f.game.routePlanner.request = request; f.step(120);
    expect(f.trade.actors.every(actor => actor.cargo === 0)).toBe(true);
    expect(f.trade.actors.some(actor => actor.waitDetail === "market-intake")).toBe(true);
    const saved = f.game.checkpoint();
    expect(() => new Skirmish(f.map(), f.options).restore(saved)).not.toThrow();
    blocked.mockRestore(); f.step(80);
    expect(service.diagnostics.departures).toBeGreaterThan(0);
  });
});
