import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function route(distance: number, inland = 0, foreign = true) {
  const terrain = new Uint8Array(140 * 40).fill(133);
  for (let y = 20; y < 30; y++)
    for (let x = 0; x < 140; x++) terrain[y * 140 + x] = 0;
  const m = new Skirmish(new GameMapImpl(140, 40, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  for (const s of m.squads) {
    m.updateSquad(s.id, { x: 130 * FIXED });
    m.updateSquad(s.id, { y: 35 * FIXED });
  }
  for (const building of m.buildings) m.removeBuilding(building.id);
  const add = (
    type: "factory" | "port",
    x: number,
    y: number,
    playerId = 1,
  ) => {
    const b = m.addBuilding({
      id: m.allocateId(),
      type,
      tile: m.map.ref(x, y),
      playerId,
      remainingTicks: 0,
      age: "StoneAge" as const,
    });

    return b;
  };
  const factory = add("factory", 10, 19 - inland);
  const port = add("port", 10, 19);
  const destination = add("port", 10 + distance, 19, foreign ? 2 : 1);
  const e = m.expansion!;
  e.progression.states[1].completed.push(
    "stoneage-cargo-canoes",
    "stoneage-craft-workshops",
  );
  const step = () => {
    m.tick++;
    e.supply.goods.set(factory.id, 1000);
    e.supply.goods.set(port.id, 1000);
    e.trade.step();
  };
  const firstDelivery = () => {
    for (let i = 0; i < 12000 && !e.trade.deliveredGold[1]; i++) step();
    return e.trade.deliveredGold[1];
  };
  return { m, e, step, firstDelivery, destination };
}

describe("water trade distance pricing", () => {
  it("pays bounded map-relative port separation independently of inland factories", () => {
    expect(route(2).firstDelivery()).toBe(414);
    expect(route(20).firstDelivery()).toBe(842);
    expect(route(100).firstDelivery()).toBe(1200);
    expect(route(2, 15).firstDelivery()).toBe(414);
    expect(route(2, 0, true).firstDelivery()).toBe(414);
  });
  it("does not deliver water trade to another port belonging to the sender", () => {
    const own = route(20, 0, false);
    for (let i = 0; i < 6000; i++) own.step();
    expect(own.e.trade.deliveredGold[1] ?? 0).toBe(0);
    expect(own.e.trade.actors.every((actor) => actor.delivered === 0)).toBe(
      true,
    );
  });
  it("still delivers to an allied foreign faction", () => {
    const allied = route(2);
    expect(
      allied.e.diplomacy.action(
        allied.m.players[0],
        allied.m.players[1],
        "offer",
        0,
      ),
    ).toBeNull();
    expect(
      allied.e.diplomacy.action(
        allied.m.players[1],
        allied.m.players[0],
        "accept",
        0,
      ),
    ).toBeNull();
    expect(allied.firstDelivery()).toBe(207);
  });
  it("returns cargo without payment when a foreign destination becomes domestic in transit", () => {
    const captured = route(20);
    for (let i = 0; i < 100 && !captured.e.trade.actors[0]?.cargo; i++)
      captured.step();
    const actor = captured.e.trade.actors[0];
    expect(actor.stops).toContain(captured.destination.id);
    expect(actor.cargo).toBeGreaterThan(0);
    captured.m.updateBuilding(captured.destination.id, { playerId: 1 });
    for (let i = 0; i < 1000 && !actor.returned; i++) captured.step();
    expect(actor.returned).toBe(actor.loaded);
    expect(actor.returned).toBeGreaterThan(0);
    expect(actor.cargo).toBe(0);
    expect(actor.delivered).toBe(0);
    expect(captured.e.trade.deliveredGold[1] ?? 0).toBe(0);
  });
  it("keeps both short and long sea routes active with bounded per-delivery payouts", () => {
    const near = route(2, 0, true),
      far = route(100, 0, true);
    for (let i = 0; i < 6000; i++) {
      near.step();
      far.step();
    }
    expect(near.e.trade.deliveredGold[1]).toBeGreaterThan(0);
    expect(near.e.trade.actors.filter(a => a.playerId === 1)).toHaveLength(1);
    expect(far.e.trade.actors.filter(a => a.playerId === 1)).toHaveLength(1);
    expect(far.e.trade.deliveredGold[1]).toBeGreaterThan(0);
    expect(far.e.trade.cycleQuotes.values().next().value!.guaranteedGold).toBe(1200);
  });
});
