import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function route(distance: number, inland = 0, foreign = false) {
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
    s.x = 130 * FIXED;
    s.y = 35 * FIXED;
  }
  m.buildings.length = 0;
  const add = (
    type: "factory" | "port",
    x: number,
    y: number,
    playerId = 1,
  ) => {
    const b = {
      id: m.allocateId(),
      type,
      tile: m.map.ref(x, y),
      playerId,
      remainingTicks: 0,
      age: "StoneAge" as const,
    };
    m.buildings.push(b);
    return b;
  };
  const factory = add("factory", 10, 19 - inland);
  add("port", 10, 19);
  add("port", 10 + distance, 19, foreign ? 2 : 1);
  const e = m.expansion!;
  e.progression.states[1].completed.push(
    "stoneage-cargo-canoes",
    "stoneage-craft-workshops",
  );
  const step = () => {
    m.tick++;
    e.supply.goods.set(factory.id, 1000);
    e.trade.step();
  };
  const firstDelivery = () => {
    for (let i = 0; i < 12000 && !e.trade.deliveredGold[1]; i++) step();
    return e.trade.deliveredGold[1];
  };
  return { m, e, step, firstDelivery };
}

describe("water trade distance pricing", () => {
  it("pays for loading-port separation with no base payout", () => {
    expect(route(2).firstDelivery()).toBe(10);
    expect(route(20).firstDelivery()).toBe(100);
    expect(route(100).firstDelivery()).toBe(500);
    expect(route(2, 15).firstDelivery()).toBe(10);
    expect(route(2, 0, true).firstDelivery()).toBe(25);
  });
  it("bounds five-minute adjacent foreign trade without rewarding faster cycles", () => {
    const near = route(2, 0, true),
      far = route(100, 0, true);
    for (let i = 0; i < 6000; i++) {
      near.step();
      far.step();
    }
    expect(near.e.trade.deliveredGold[1]).toBeGreaterThan(0);
    expect(near.e.trade.deliveredGold[1]).toBeLessThan(5000);
    expect(far.e.trade.deliveredGold[1]).toBeGreaterThan(
      near.e.trade.deliveredGold[1],
    );
  });
});
