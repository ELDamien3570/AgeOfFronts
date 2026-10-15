import {secondsToTicks} from '../../src/skirmish/Protocol';
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
  e.progression.states[1].completed.push("rus-stoneage-land-traders");
  e.supply.goods.set(factory.id, 25);
  tradeStep(m, secondsToTicks(1.1));
  const actor = e.trade.actors[0];
  expect(actor.cargo).toBe(25);
  return { m, e, factory, actor };
}
describe("authoritative match metrics", () => {
  it("splits capped soldier deaths proportionally without counting overkill", () => {
    const m = match(),
      victim = m.squads.find((s) => s.playerId === 2)!,
      hits = new DamageLedger();
    m.updateSquad(victim.id, { troops: 11 });
    hits.add(victim.id, 1, 900);
    hits.add(victim.id, 3, 300);
    m.resolveLandDamage(hits);
    expect(m.players[1].losses).toBe(11);
    expect(m.players[0].kills).toBe(9);
    expect(m.players[2].kills).toBe(2);
    m.resolveLandDamage(hits);
    expect(m.players[0].kills).toBe(9);
  });
  it("counts partial losses and simultaneous mutual kills as soldiers", () => {
    const m = match(),
      a = m.squads.find((s) => s.playerId === 1)!,
      b = m.squads.find((s) => s.playerId === 2)!;
    const partial = new DamageLedger();
    partial.add(b.id, 1, 400);
    m.resolveLandDamage(partial);
    expect(m.players[0].kills).toBe(4);
    expect(m.players[1].losses).toBe(4);
    m.updateSquad(a.id, { troops: 8 });
    m.updateSquad(b.id, { troops: 9 });
    const mutual = new DamageLedger();
    mutual.add(a.id, 2, 999);
    mutual.add(b.id, 1, 999);
    m.resolveLandDamage(mutual);
    expect(m.players[0].kills).toBe(13);
    expect(m.players[0].losses).toBe(8);
    expect(m.players[1].kills).toBe(8);
    expect(m.players[1].losses).toBe(13);
  });
  it("counts embarked soldiers on sinking, excluding ship health", () => {
    const m = match(),
      passenger = m.squads.find((s) => s.playerId === 2)!;
    const ship: Ship = m.addShip({
      id: m.allocateId(),
      playerId: 2,
      kind: "warship",
      x: 0,
      y: 0,
      health: 100,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
    });

    m.updateSquad(passenger.id, { embarkedOn: ship.id });
    m.updateSquad(passenger.id, { troops: 7 });
    const hits = new DamageLedger();
    hits.add(ship.id, 1, 900);
    hits.add(ship.id, 3, 300);
    m.resolveNavalDamage(hits);
    expect(m.players[1].losses).toBe(7);
    expect(m.players[0].kills).toBe(6);
    expect(m.players[2].kills).toBe(1);
    m.addShip({ ...ship, id: m.allocateId(), health: 100 });
    const empty = new DamageLedger();
    empty.add(m.ships[0].id, 1, 1000);
    m.resolveNavalDamage(empty);
    expect(m.players[0].kills).toBe(6);
  });
  it("records cargo captures immediately at load value, without double settlement", () => {
    const { m, e, actor } = shipment(),
      captor = m.squads.find((s) => s.playerId === 2)!;
    const gold = m.players[1].gold;
    expect(e.diplomacy.action(m.players[1],m.players[0],"declare",m.tick)).toBeNull();
    m.updateSquad(captor.id, { x: actor.x });
    m.updateSquad(captor.id, { y: actor.y });
    actor.waitTicks = 0;
    e.progression.states[1].age = "Modern";
    tradeStep(m);
    expect(e.trade.capturedValue[2]).toBe(500);
    expect(e.trade.lostValue[1]).toBe(500);
    expect(m.players[1].gold).toBe(gold);
    tradeStep(m, secondsToTicks(0.5));
    expect(e.trade.capturedValue[2]).toBe(500);
    m.updateSquad(captor.id, { x: 85 * FIXED });
    const recaptor = m.squads.find((s) => s.playerId === 1)!;
    m.updateSquad(recaptor.id, { x: actor.x });
    m.updateSquad(recaptor.id, { y: actor.y });
    actor.waitTicks = 0;
    tradeStep(m);
    expect(e.trade.capturedValue[1]).toBe(500);
    expect(e.trade.lostValue[2]).toBe(500);
  });
  it("records discarded cargo once and preserves shipment conservation", () => {
    const { m, e, actor } = shipment();
    m.players[0].eliminated = true;
    tradeStep(m, secondsToTicks(0.1));
    expect(e.trade.lostValue[1]).toBe(500);
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
    expect(actor.returned).toBe(25);
    expect(e.trade.lostValue[1] ?? 0).toBe(0);
    e.supply.goods.set(factory.id, 25);
    tradeStep(m, secondsToTicks(1.1));
    for (let i = 0; i < 1000 && !actor.delivered; i++) tradeStep(m);
    expect(actor.delivered).toBeGreaterThan(0);
    expect(e.trade.lostValue[1] ?? 0).toBe(0);
  });
  it("preserves totals through checkpoints and snapshot encoding for the inspected player", () => {
    const { m, e, actor } = shipment(),
      captor = m.squads.find((s) => s.playerId === 2)!;
    expect(e.diplomacy.action(m.players[1],m.players[0],"declare",m.tick)).toBeNull();
    m.updateSquad(captor.id, { x: actor.x });
    m.updateSquad(captor.id, { y: actor.y });
    actor.waitTicks = 0;
    tradeStep(m);
    const hits = new DamageLedger();
    hits.add(m.squads.find((s) => s.playerId === 1)!.id, 2, 400);
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
      kills: 4,
      deaths: 0,
      tradeCaptured: 500,
      tradeLost: 0,
    });
    expect(new MatchMetricsViewModel(snapshot, 1)).toMatchObject({
      deaths: 4,
      tradeLost: 500,
    });
    delete snapshot.players[1].kills;
    delete snapshot.expansion!.tradeCapturedValue;
    expect(new MatchMetricsViewModel(snapshot, 2).kills).toBe(0);
    expect(new MatchMetricsViewModel(snapshot, 2).tradeCaptured).toBe(0);
  });
});
