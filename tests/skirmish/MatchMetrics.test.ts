import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { MatchMetricsViewModel } from "../../src/skirmish/client/MatchMetricsViewModel";
import { DamageLedger } from "../../src/skirmish/Conquest";
import { FIXED, type Building, type Ship } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function match() {
  const cells = new Uint8Array(96 * 64).fill(133);
  const m = new Skirmish(new GameMapImpl(96, 64, cells, cells.length), {
    seed: 47,
    aiCount: 2,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  for (const s of m.squads) {
    m.updateSquad(s.id, { x: 85 * FIXED });
    m.updateSquad(s.id, { y: s.playerId * 15 * FIXED });
    m.updateSquad(s.id, { order: { type: "hold" } });
  }
  return m;
}
function building(m: Skirmish, type: Building["type"], x: number, owner = 1) {
  const b: Building = m.addBuilding({
    id: m.allocateId(),
    type,
    tile: m.map.ref(x, 10),
    playerId: owner,
    age: "StoneAge",
    remainingTicks: 0,
    health: 2000,
    maxHealth: 2000,
  });
  if (type === "factory") for (let y = 0; y < 20; y++) for (let x = 0; x < 32; x++) m.owners[m.map.ref(x, y)] = 1;

  return b;
}
function tradeStep(m: Skirmish, n = 1) {
  for (let i = 0; i < n; i++) {
    m.tick++;
    m.expansion!.trade.step();
  }
}
function shipment() {
  const m = match(),
    e = m.expansion!,
    factory = building(m, "factory", 10);
  building(m, "city", 20);
  building(m, "city", 11, 2);
  e.progression.states[1].completed.push("stoneage-goods-handling");
  e.supply.goods.set(factory.id, 20);
  tradeStep(m, 22);
  const actor = e.trade.actors[0];
  expect(actor.cargo).toBe(20);
  return { m, e, factory, actor };
}
describe("authoritative match metrics", () => {
  it("splits capped soldier deaths proportionally without counting overkill", () => {
    const m = match(),
      victim = m.squads.find((s) => s.playerId === 2)!,
      hits = new DamageLedger();
    m.updateSquad(victim.id, { troops: 101 });
    hits.add(victim.id, 1, 300);
    hits.add(victim.id, 3, 100);
    m.resolveLandDamage(hits);
    expect(m.players[1].losses).toBe(101);
    expect(m.players[0].kills).toBe(76);
    expect(m.players[2].kills).toBe(25);
    m.resolveLandDamage(hits);
    expect(m.players[0].kills).toBe(76);
  });
  it("counts partial losses and simultaneous mutual kills as soldiers", () => {
    const m = match(),
      a = m.squads.find((s) => s.playerId === 1)!,
      b = m.squads.find((s) => s.playerId === 2)!;
    const partial = new DamageLedger();
    partial.add(b.id, 1, 40);
    m.resolveLandDamage(partial);
    expect(m.players[0].kills).toBe(40);
    expect(m.players[1].losses).toBe(40);
    m.updateSquad(a.id, { troops: 80 });
    m.updateSquad(b.id, { troops: 90 });
    const mutual = new DamageLedger();
    mutual.add(a.id, 2, 999);
    mutual.add(b.id, 1, 999);
    m.resolveLandDamage(mutual);
    expect(m.players[0].kills).toBe(130);
    expect(m.players[0].losses).toBe(80);
    expect(m.players[1].kills).toBe(80);
    expect(m.players[1].losses).toBe(130);
  });
  it("counts embarked soldiers on sinking, excluding ship health", () => {
    const m = match(),
      passenger = m.squads.find((s) => s.playerId === 2)!;
    const ship: Ship = m.addShip({
      id: m.allocateId(),
      playerId: 2,
      kind: "transport",
      x: 0,
      y: 0,
      health: 100,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
      boarding: null,
    });

    m.updateSquad(passenger.id, { embarkedOn: ship.id });
    m.updateSquad(passenger.id, { troops: 700 });
    const hits = new DamageLedger();
    hits.add(ship.id, 1, 300);
    hits.add(ship.id, 3, 100);
    m.resolveNavalDamage(hits);
    expect(m.players[1].losses).toBe(700);
    expect(m.players[0].kills).toBe(525);
    expect(m.players[2].kills).toBe(175);
    m.addShip({ ...ship, id: m.allocateId(), health: 100 });
    const empty = new DamageLedger();
    empty.add(m.ships[0].id, 1, 1000);
    m.resolveNavalDamage(empty);
    expect(m.players[0].kills).toBe(525);
  });
  it("records cargo captures immediately at load value, without double settlement", () => {
    const { m, e, actor } = shipment(),
      captor = m.squads.find((s) => s.playerId === 2)!;
    const gold = m.players[1].gold;
    m.updateSquad(captor.id, { x: actor.x });
    m.updateSquad(captor.id, { y: actor.y });
    actor.waitTicks = 0;
    e.progression.states[1].age = "Modern";
    tradeStep(m);
    expect(e.trade.capturedValue[2]).toBe(100);
    expect(e.trade.lostValue[1]).toBe(100);
    expect(m.players[1].gold).toBe(gold);
    tradeStep(m, 10);
    expect(e.trade.capturedValue[2]).toBe(100);
    m.updateSquad(captor.id, { x: 85 * FIXED });
    const recaptor = m.squads.find((s) => s.playerId === 1)!;
    m.updateSquad(recaptor.id, { x: actor.x });
    m.updateSquad(recaptor.id, { y: actor.y });
    actor.waitTicks = 0;
    tradeStep(m);
    expect(e.trade.capturedValue[1]).toBe(100);
    expect(e.trade.lostValue[2]).toBe(100);
  });
  it("records discarded cargo once and preserves shipment conservation", () => {
    const { m, e, actor } = shipment();
    m.players[0].eliminated = true;
    tradeStep(m, 2);
    expect(e.trade.lostValue[1]).toBe(100);
    expect(actor.cargo).toBe(0);
    expect(actor.loaded).toBe(actor.delivered + actor.returned + actor.lost);
    expect(e.trade.capturedValue[2] ?? 0).toBe(0);
  });
  it("does not count returned cargo or normal deliveries as lost", () => {
    const { m, e, actor, factory } = shipment();
    actor.state = "returning";
    actor.destination = factory.id;
    actor.path = [];
    actor.waitTicks = 0;
    tradeStep(m);
    expect(actor.returned).toBe(20);
    expect(e.trade.lostValue[1] ?? 0).toBe(0);
    e.supply.goods.set(factory.id, 20);
    tradeStep(m, 22);
    for (let i = 0; i < 1000 && !actor.delivered; i++) tradeStep(m);
    expect(actor.delivered).toBeGreaterThan(0);
    expect(e.trade.lostValue[1] ?? 0).toBe(0);
  });
  it("preserves totals through checkpoints and snapshot encoding for the inspected player", () => {
    const { m, e, actor } = shipment(),
      captor = m.squads.find((s) => s.playerId === 2)!;
    m.updateSquad(captor.id, { x: actor.x });
    m.updateSquad(captor.id, { y: actor.y });
    actor.waitTicks = 0;
    tradeStep(m);
    const hits = new DamageLedger();
    hits.add(m.squads.find((s) => s.playerId === 1)!.id, 2, 42);
    m.resolveLandDamage(hits);
    const saved = m.checkpoint();
    e.trade.capturedValue[2] = 999;
    m.players[1].kills = 999;
    m.restore(saved);
    const snapshot = new SnapshotDecoder().decode(
      new SnapshotEncoder().encode(m.snapshot()),
    );
    const metrics = new MatchMetricsViewModel(snapshot, 2);
    expect(metrics).toMatchObject({
      kills: 42,
      deaths: 0,
      tradeCaptured: 100,
      tradeLost: 0,
    });
    expect(new MatchMetricsViewModel(snapshot, 1)).toMatchObject({
      deaths: 42,
      tradeLost: 100,
    });
    delete snapshot.players[1].kills;
    delete snapshot.expansion!.tradeCapturedValue;
    expect(new MatchMetricsViewModel(snapshot, 2).kills).toBe(0);
    expect(new MatchMetricsViewModel(snapshot, 2).tradeCaptured).toBe(0);
  });
});
