import { describe, expect, it } from "vitest";
import { Skirmish } from "../../src/skirmish/Simulation";
import { encodeState, decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { seaFleet } from "./SeaTradeFixture";
describe("sea trade persistence", () => {
  it.each([8, 10, 14, 30, 120, 240])("continues portable and repeated cold restore at tick %s", async tick => {
    const f = seaFleet(); f.step(tick);
    const saved = await decodeState<ReturnType<Skirmish["checkpoint"]>>(await encodeState(f.game.checkpoint()));
    const cold = new Skirmish(f.map(), f.options); cold.restore(saved); cold.restore(saved);
    expect(cold.checkpoint()).toEqual(f.game.checkpoint());
    for (let i = 0; i < 8; i++) { f.game.step(); cold.step(); expect(cold.checkpoint()).toEqual(f.game.checkpoint()); }
  });
  it("keeps diagnostic event observation outside canonical state", () => {
    const f = seaFleet(), cold = new Skirmish(f.map(), f.options);
    cold.restore(f.game.checkpoint()); let events = 0;
    f.trade.seaTrade!.onEvent = () => { events++; };
    f.trade.seaTrade!.routes.onEvent = () => { events++; };
    for (let i = 0; i < 32; i++) { f.game.step(); cold.step(); expect(cold.checkpoint()).toEqual(f.game.checkpoint()); }
    expect(events).toBeGreaterThan(0);
  });
  it("rejects absent state, unknown versions and corrupt references", () => {
    const f = seaFleet(); f.step(30);
    const missing = f.game.checkpoint(); delete missing.expansion!.trade.seaTrade;
    expect(() => new Skirmish(f.map(), f.options).restore(missing)).toThrow("envelope");
    const unknown = f.game.checkpoint(); (unknown.expansion!.trade.seaTrade!.version as number) = 2;
    expect(() => new Skirmish(f.map(), f.options).restore(unknown)).toThrow("envelope");
    const corrupt = f.game.checkpoint(); corrupt.expansion!.trade.seaTrade!.routes.lanes[0].references++;
    expect(() => new Skirmish(f.map(), f.options).restore(corrupt)).toThrow("reference");
  });
  it("rejects oversized nested retention before cloning and unknown private demand/wait forms", () => {
    const f = seaFleet(); f.step(30);
    const retention = f.game.checkpoint();
    retention.expansion!.trade.seaTrade!.routes.sourceRetention = [["1:1", [1, 2, 3]]];
    expect(() => new Skirmish(f.map(), f.options).restore(retention)).toThrow("retention envelope");
    const hints = f.game.checkpoint();
    hints.expansion!.trade.seaTrade!.ports.sourceHints = [["1:1:1", [1, 2, 3]]];
    expect(() => new Skirmish(f.map(), f.options).restore(hints)).toThrow("source hints envelope");
    const malformed = f.game.checkpoint();
    malformed.expansion!.trade.seaTrade!.ports.sourceHints = [["1:01:1", [1]]];
    expect(() => new Skirmish(f.map(), f.options).restore(malformed)).toThrow("source hints");
    const wait = f.game.checkpoint(), voyage = wait.expansion!.trade.seaTrade!.voyages[0][1];
    (voyage as any).wait = { cause: "toString", since: f.game.tick, loading: false };
    expect(() => new Skirmish(f.map(), f.options).restore(wait)).toThrow("voyage wait");
    const counters = f.game.checkpoint();
    delete (counters.expansion!.trade.seaTrade!.voyages[0][1].loadingWaits as any).route;
    expect(() => new Skirmish(f.map(), f.options).restore(counters)).toThrow("sea voyage");
  });
  it("rejects a nonlegacy loaded voyage that has lost its only known way home", () => {
    const f = seaFleet(); f.step(30); const saved = f.game.checkpoint(), sea = saved.expansion!.trade.seaTrade!;
    const actor = saved.expansion!.trade.actors.find(actor => actor.naval && actor.cargo > 0)!;
    const voyage = sea.voyages.find(([id]) => id === actor.id)![1], laneId = voyage.leg!.laneId;
    voyage.leg = undefined; actor.destination = null;
    sea.routes.subscriptions = sea.routes.subscriptions.filter(sub => sub.key !== `actor:${actor.id}:leg`);
    sea.routes.lanes.find(lane => lane.id === laneId)!.references--;
    expect(() => new Skirmish(f.map(), f.options).restore(saved)).toThrow("no known return geometry");
  });
  it("rejects a valid port ID that disagrees with the active lane's physical destination", () => {
    const f = seaFleet(1, 2); f.step(30); const saved = f.game.checkpoint();
    const actor = saved.expansion!.trade.actors.find(actor => actor.naval && actor.cargo > 0)!;
    actor.destination = f.receivers.find(port => port.id !== actor.destination)!.id;
    expect(() => new Skirmish(f.map(), f.options).restore(saved)).toThrow("destination geometry");
  });
  it("rejects a source dispatch whose saved endpoint disagrees with its registered lane", () => {
    const f = seaFleet(); f.game.routePlanner.request = () => false; f.step(32);
    const saved = f.game.checkpoint(), dispatch = saved.expansion!.trade.seaTrade!.dispatches[0][1];
    dispatch.goalTile += 20;
    expect(() => new Skirmish(f.map(), f.options).restore(saved)).toThrow("source subscription");
  });
  it("does not mistake index reconstruction for market churn, but preserves a real saved mutation", () => {
    const f = seaFleet(); f.step(30);
    f.game.addBuilding({ ...f.receivers[0], id: f.game.allocateId(), tile: f.game.map.ref(120, 50) });
    const saved = f.game.checkpoint(); expect(saved.expansion!.trade.seaMarketDirty).toBe(true);
    const cold = new Skirmish(f.map(), f.options); cold.restore(saved);
    for (let i = 0; i < 16; i++) { f.game.step(); cold.step(); expect(cold.checkpoint()).toEqual(f.game.checkpoint()); }
  });
});
