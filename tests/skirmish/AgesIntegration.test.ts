import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { SkirmishViewModel } from "../../src/skirmish/client/SkirmishViewModel";
import { DamageLedger } from "../../src/skirmish/Conquest";
import {
  CONTENT_HASH,
  validateCatalog,
} from "../../src/skirmish/content/Catalog";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { defaultUnit, VESSEL } from "../../src/skirmish/content/Units";
import { FIXED, type Building, type Ship } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { SpatialGrid } from "../../src/skirmish/SpatialGrid";

function match(water = false, ai = false) {
  const data = new Uint8Array(96 * 64).fill(133);
  if (water)
    for (let y = 20; y < 40; y++)
      for (let x = 0; x < 96; x++) data[y * 96 + x] = 0;
  const m = new Skirmish(new GameMapImpl(96, 64, data, data.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: ai,
    ruleset: "ages-v1",
  });
  for (const s of m.squads) {
    s.x = 85 * FIXED;
    s.y = (s.playerId === 1 ? 3 : 55) * FIXED;
    s.order = { type: "hold" };
  }
  return m;
}
function complete(m: Skirmish) {
  for (const p of m.players) {
    const state = m.expansion!.progression.states[p.id];
    state.age = "Modern";
    state.completed = TECHNOLOGIES.map((t) => t.id);
    p.gold = 1e7;
    p.reserves = 100000;
  }
}
function building(
  m: Skirmish,
  type: Building["type"],
  x: number,
  y: number,
  playerId = 1,
  age: Building["age"] = "StoneAge",
) {
  const b: Building = {
    id: m.allocateId(),
    type,
    tile: m.map.ref(x, y),
    playerId,
    age,
    remainingTicks: 0,
    health: 2000,
    maxHealth: 2000,
  };
  m.buildings.push(b);
  return b;
}
function ship(m: Skirmish, x: number, playerId = 1) {
  const s: Ship = {
    id: m.allocateId(),
    playerId,
    kind: "warship",
    definitionId: "stoneage-warship",
    x: (x + 0.5) * FIXED,
    y: 30.5 * FIXED,
    health: 1000,
    destination: null,
    waypoints: [],
    path: [],
    nextPathIndex: 0,
    fighting: false,
    boarding: null,
  };
  m.ships.push(s);
  return s;
}
function tradeStep(m: Skirmish, n = 1) {
  for (let i = 0; i < n; i++) {
    m.tick++;
    m.expansion!.trade.step();
  }
}
describe("integrated shipments and military progression", () => {
  it("excludes friendly spatial partitions without hiding mixed cells after rebuilds", () => {
    const grid = new SpatialGrid<{ x: number; y: number; playerId: number }>(
        100,
        100,
        10,
        (s) => s.playerId,
      ),
      a = { x: 5, y: 5, playerId: 1 },
      b = { x: 6, y: 5, playerId: 2 },
      result: (typeof a)[] = [];
    grid.rebuild([a]);
    grid.query(5, 5, 10, result, 1);
    expect(result).toHaveLength(0);
    grid.rebuild([a, b]);
    grid.query(5, 5, 10, result, 1);
    expect(result).toEqual([b]);
    grid.rebuild([b]);
    grid.query(5, 5, 10, result, 1);
    expect(result).toEqual([b]);
    grid.query(5, 5, 10, result);
    expect(result).toEqual([b]);
  });
  it("exposes each clicked faction's current age from the authoritative snapshot", () => {
    const m = match();
    m.expansion!.progression.states[2].age = "LateMedieval";
    const vm = new EmpireViewModel(m.snapshot(), {
      selected: new Set(),
      selectedShips: new Set(),
      selectedBuilding: null,
    });
    expect(vm.faction(2)?.ageName).toBe("Late Medieval");
    expect(vm.faction(1)?.ageName).toBe("Stone Age");
    expect(vm.faction(999)).toBeNull();
  });
  it("retains cardinal trade roads across snapshot deltas and replaces them on reset", () => {
    const m = match(),
      e = m.expansion!,
      a = m.map.ref(10, 10),
      b = m.map.ref(11, 11);
    e.roads.add([a, b], "BronzeAge");
    const first = e.roads.packed();
    expect(first.length).toBe(9);
    expect(first[2]).toBe(2);
    expect(first[8]).toBe(1);
    const encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    expect(
      decoder.decode(encoder.encode(m.snapshot())).expansion!.roads,
    ).toEqual(first);
    const packet = encoder.encode(m.snapshot());
    expect(packet.expansion!.roads).toBeUndefined();
    expect(decoder.decode(packet).expansion!.roads).toEqual(first);
    e.roads.add([a, b], "Modern");
    expect(
      decoder.decode(encoder.encode(m.snapshot())).expansion!.roads![1],
    ).toBe(6);
    expect(
      decoder.decode(new SnapshotEncoder().encode(match().snapshot()))
        .expansion!.roads,
    ).toHaveLength(0);
  });
  it("announces regular conquests while keeping tribal defeats out of the feed", () => {
    for (const tribal of [false, true]) {
      const m = match(),
        enemy = m.players[1],
        victims = m.squads.filter((s) => s.playerId === 2),
        ledger = new DamageLedger();
      enemy.kind = tribal ? "tribe" : "regular";
      for (const victim of victims) ledger.add(victim.id, 1, 1000);
      m.resolveLandDamage(ledger);
      m.step();
      expect(enemy.eliminated).toBe(true);
      expect(
        m.expansion!.events.filter((e) => e.kind === "conquest"),
      ).toHaveLength(tribal ? 0 : 1);
      expect(m.owners.includes(2)).toBe(false);
    }
  });
  it("rejects malformed nested orders atomically at the command boundary", () => {
    const m = match(),
      s = m.squads[0],
      before = JSON.stringify(s);
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [s.id],
        order: { type: "surprise" },
      } as never),
    ).toMatch(/Invalid order/);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("validates the resolved culture and exposes a stable compatibility identifier", () => {
    expect(() => validateCatalog()).not.toThrow();
    expect(CONTENT_HASH).toMatch(/^[a-f0-9]{8}$/);
    expect(match().snapshot().expansion!.contentHash).toBe(CONTENT_HASH);
  });
  it("returns a finite load when its remaining stop disappears, without paying returned cargo", () => {
    const m = match(),
      e = m.expansion!,
      factory = building(m, "factory", 10, 10),
      a = building(m, "city", 14, 10),
      b = building(m, "city", 18, 10);
    e.supply.goods.set(factory.id, 20);
    tradeStep(m, 22);
    const actor = e.trade.actors[0];
    expect(actor.loaded).toBe(20);
    for (let i = 0; i < 1000 && !actor.delivered; i++) tradeStep(m);
    expect(actor.visited).toEqual([a.id]);
    const gold = e.trade.deliveredGold[1];
    m.buildings.splice(m.buildings.indexOf(b), 1);
    for (let i = 0; i < 1000 && !actor.returned; i++) tradeStep(m);
    expect(actor.returned).toBe(10);
    expect(actor.cargo).toBe(0);
    expect(e.supply.goods.get(factory.id)).toBe(10);
    expect(e.trade.deliveredGold[1]).toBe(gold);
    expect(actor.loaded).toBe(
      actor.cargo + actor.delivered + actor.returned + actor.lost,
    );
  });
  it("pins shipment value at loading and settles captured remaining cargo exactly once", () => {
    const m = match(),
      e = m.expansion!,
      factory = building(m, "factory", 10, 10);
    building(m, "city", 20, 10);
    const prize = building(m, "city", 11, 10, 2);
    e.supply.goods.set(factory.id, 20);
    tradeStep(m, 22);
    const actor = e.trade.actors[0];
    expect(actor.valuePerGood).toBe(50);
    e.progression.states[1].age = "Modern";
    expect(actor.valuePerGood).toBe(50);
    const captor = m.squads.find((s) => s.playerId === 2)!;
    captor.x = actor.x;
    captor.y = actor.y;
    actor.waitTicks = 0;
    tradeStep(m);
    expect(actor.state).toBe("prize");
    expect(actor.playerId).toBe(2);
    expect(actor.destination).toBe(prize.id);
    captor.x = 85 * FIXED;
    for (let i = 0; i < 200 && e.trade.actors.includes(actor); i++)
      tradeStep(m);
    expect(e.trade.actors).not.toContain(actor);
    expect(e.trade.deliveredGold[2]).toBe(1000);
    const paid = m.players[1].gold;
    tradeStep(m, 100);
    expect(m.players[1].gold).toBe(paid);
  });
  it("approaches naval attack targets, damages on cooldown and awards effective promotion XP", () => {
    const m = match(true),
      s = ship(m, 10),
      t = ship(m, 30, 2);
    expect(
      m.applyCommand({
        type: "naval-attack",
        playerId: 1,
        shipIds: [s.id],
        targetId: t.id,
      }),
    ).toBeNull();
    for (let i = 0; i < 300 && t.health === 1000; i++) m.step();
    expect(s.x).toBeGreaterThan(10.5 * FIXED);
    expect(t.health).toBeLessThan(1000);
    expect(s.xp).toBeGreaterThan(0);
    const health = t.health;
    m.step();
    expect(t.health).toBe(health);
  });
  it("refits a fleet atomically, preserves health, resets XP and rejects movement during refit", () => {
    const m = match(true);
    complete(m);
    const s = ship(m, 10),
      t = ship(m, 11);
    s.health = 400;
    s.xp = 3000;
    const target = VESSEL.get("modern-warship")!;
    const before = m.players[0].gold;
    expect(
      m.applyCommand({
        type: "refit-ships",
        playerId: 1,
        shipIds: [s.id, t.id],
        definitionId: target.id,
      }),
    ).toMatch(/Needs/);
    expect(s.refit).toBeUndefined();
    expect(m.players[0].gold).toBe(before);
    Object.assign(m.expansion!.supply.inventories[1], {
      oil: 100,
      steel: 100,
      gunpowder: 100,
    });
    expect(
      m.applyCommand({
        type: "refit-ships",
        playerId: 1,
        shipIds: [s.id, t.id],
        definitionId: target.id,
      }),
    ).toBeNull();
    expect(
      m.applyCommand({
        type: "sail",
        playerId: 1,
        shipIds: [s.id],
        tile: m.map.ref(20, 30),
      }),
    ).toMatch(/own ships/);
    for (let i = 0; i < 200; i++) m.expansion!.beforeStep();
    expect(s.definitionId).toBe(target.id);
    expect(s.health).toBe(400);
    expect(s.xp).toBe(0);
  });
  it("prevents shell splash crossing an intact wall while damaging the wall", () => {
    const m = match(),
      e = m.expansion!,
      a = building(m, "tower", 20, 19, 2),
      b = building(m, "tower", 20, 23, 2);
    e.fortifications.addTower(
      b,
      e.fortifications.towerPlan(b.tile, 2, "StoneAge", [a, b]),
    );
    e.fortifications.step(1, m.buildings);
    const source = m.squads[0],
      target = m.squads.find((s) => s.playerId === 2)!;
    source.x = 15.5 * FIXED;
    source.y = 21.5 * FIXED;
    target.x = 21.5 * FIXED;
    target.y = source.y;
    const profile = {
      ...defaultUnit("infantry").attack,
      channel: "ranged" as const,
      damage: 100,
      projectile: {
        diameter: FIXED / 4,
        speed: 20 * FIXED,
        blastRadius: 4 * FIXED,
      },
    };
    e.battle.fire(source, { x: 25.5 * FIXED, y: source.y }, profile, 100);
    m.tick++;
    e.battle.advanceProjectiles();
    expect(target.troops).toBe(1000);
    expect(e.fortifications.barriers[0].health).toBeLessThan(
      e.fortifications.barriers[0].maxHealth,
    );
  });
  it("emits advances and incoming diplomacy once, but excludes tribes from war announcements", () => {
    const m = match(),
      e = m.expansion!;
    e.progression.states[2].advancement = {
      target: "BronzeAge",
      remainingTicks: 1,
      totalTicks: 1,
    };
    e.beforeStep();
    expect(e.events.filter((x) => x.kind === "age")).toHaveLength(1);
    e.beforeStep();
    expect(e.events.filter((x) => x.kind === "age")).toHaveLength(1);
    expect(
      m.applyCommand({
        type: "alliance",
        playerId: 2,
        otherId: 1,
        action: "offer",
      }),
    ).toBeNull();
    expect(e.events.slice(-1)[0]?.action).toBe("offer");
    const count = e.events.length;
    m.applyCommand({
      type: "alliance",
      playerId: 2,
      otherId: 1,
      action: "offer",
    });
    expect(e.events).toHaveLength(count);
    expect(
      m.applyCommand({
        type: "alliance",
        playerId: 1,
        otherId: 2,
        action: "offer",
      }),
    ).toBeNull();
    expect(e.diplomacy.allied(1, 2)).toBe(true);
    expect(e.events.slice(-1)[0]).toMatchObject({
      kind: "diplomacy",
      actorId: 1,
      otherId: 2,
      action: "accept",
    });
  });
  it("uses Auto tier to fall back to affordable unlocked recruitment, without falling back in manual mode", () => {
    const m = match();
    complete(m);
    const b = building(m, "barracks", 10, 10, 1, "Modern");
    m.owners[b.tile] = 1;
    const state = m.snapshot(),
      selection = {
        selected: new Set<number>(),
        selectedShips: new Set<number>(),
        selectedBuilding: null,
      };
    const auto = new SkirmishViewModel(state, selection, {}, true);
    expect(auto.recruitment("infantry").definitionId).toBe("stoneage-infantry");
    const manual = new SkirmishViewModel(state, selection, {
      infantry: "modern-infantry",
    });
    expect(manual.recruitment("infantry").enabled).toBe(false);
    state.expansion!.inventories[1]["equipment:modern-infantry"] = 1;
    expect(auto.recruitment("infantry").definitionId).toBe("modern-infantry");
    const limited = new SkirmishViewModel(
      state,
      selection,
      {},
      true,
      "StoneAge",
    );
    expect(limited.recruitment("infantry").definitionId).toBe(
      "stoneage-infantry",
    );
  });
  it("lets regular AI develop economy, research and modern capabilities through the same command boundary", () => {
    const m = match(false, true);
    complete(m);
    const p = m.players[1];
    Object.assign(m.expansion!.supply.inventories[2], {
      steel: 1000,
      stone: 1000,
      oil: 1000,
      "equipment:fighter": 2,
      "equipment:bomber": 2,
    });
    building(m, "airstrip", 85, 55, 2, "Modern");
    for (let i = 0; i < 10; i++) m.step();
    expect(m.expansion!.aircraft.some((a) => a.playerId === p.id)).toBe(true);
    expect(
      m.buildings.some((b) => b.playerId === p.id && b.type === "city"),
    ).toBe(true);
  });
  it("requires stationary deployment and a finite payload for mobile MIRV launch", () => {
    const m = match();
    complete(m);
    const s = m.squads[0];
    s.definitionId = "modern-launcher";
    s.order = { type: "hold" };
    const stock = m.expansion!.supply.inventories[1];
    stock["payload:mirv"] = 1;
    const command = {
      type: "launch" as const,
      playerId: 1,
      launcherId: s.id,
      payload: "mirv" as const,
      x: 40 * FIXED,
      y: 30 * FIXED,
    };
    expect(m.applyCommand(command)).toMatch(/five seconds/);
    expect(stock["payload:mirv"]).toBe(1);
    s.deploymentTicks = 100;
    expect(m.applyCommand(command)).toBeNull();
    expect(stock["payload:mirv"]).toBe(0);
    expect(m.applyCommand(command)).toMatch(/reloading/);
    expect(m.expansion!.battle.projectiles).toHaveLength(1);
  });
});
