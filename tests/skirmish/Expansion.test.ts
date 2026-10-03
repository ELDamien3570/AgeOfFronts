import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import type { BuildingType, Squad } from "../../src/skirmish/Protocol";
import {
  FIXED,
  MAX_QUEUED_ORDERS,
  TICKS_PER_SECOND,
} from "../../src/skirmish/Protocol";
import {
  BUILDING_RULES,
  REPLENISH_DELAY,
  SHIP_RULES,
} from "../../src/skirmish/Rules";
import { Skirmish } from "../../src/skirmish/Simulation";

function match(coastal = false): Skirmish {
  const width = 80,
    height = 50,
    terrain = new Uint8Array(width * height).fill(133);
  if (coastal)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (y < 8 || y > 41 || x < 8 || x > 71) terrain[y * width + x] = 0;
  return new Skirmish(new GameMapImpl(width, height, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    runAi: false,
  });
}
function step(m: Skirmish, ticks: number): void {
  for (let i = 0; i < ticks; i++) m.step();
}
function place(s: Pick<Squad, "x" | "y">, x: number, y: number): void {
  s.x = x * FIXED + FIXED / 2;
  s.y = y * FIXED + FIXED / 2;
}
function own(m: Skirmish, tile: number, id = 1): void {
  const old = m.owners[tile];
  if (old === id) return;
  if (old) m.player(old)!.land--;
  m.owners[tile] = id;
  m.player(id)!.land++;
}
function build(m: Skirmish, type: BuildingType, x: number, y: number, id = 1) {
  const tile = m.map.ref(x, y);
  own(m, tile, id);
  m.player(id)!.gold = 10000;
  expect(
    m.applyCommand({ type: "build", playerId: id, buildingType: type, tile }),
  ).toBeNull();
  return m.buildings[m.buildings.length - 1];
}
function single(m: Skirmish): Squad {
  const s = m.squads[0];
  // Retain a distant enemy so normal victory rules still apply.
  const e = m.squads.find((s) => s.playerId === 2)!;
  for (const removed of m.squads)
    if (removed !== s && removed !== e)
      m.player(removed.playerId)!.losses += removed.troops;
  m.squads.splice(0, m.squads.length, s, e);
  place(s, 30, 25);
  place(e, 65, 35);
  return s;
}
function account(m: Skirmish): number {
  return (
    m.players.reduce((sum, p) => sum + p.reserves + p.losses, 0) +
    m.squads.reduce((sum, s) => sum + s.troops, 0)
  );
}

describe("queued orders", () => {
  it("walks every waypoint in order, including a bend, then holds", () => {
    const m = match(),
      s = single(m);
    const tiles = [m.map.ref(34, 25), m.map.ref(34, 29), m.map.ref(38, 29)];
    tiles.forEach((tile, i) =>
      expect(
        m.applyCommand({
          type: "order",
          playerId: 1,
          squadIds: [s.id],
          order: { type: "move", tile },
          append: i > 0,
        }),
      ).toBeNull(),
    );
    const visited: number[] = [];
    for (let i = 0; i < 200; i++) {
      m.step();
      const t = m.tileOf(s);
      if (tiles.includes(t) && !visited.includes(t)) visited.push(t);
    }
    expect(visited).toEqual(tiles);
    expect(s.order.type).toBe("hold");
    expect(s.queuedOrders).toEqual([]);
    expect(s.x).toBe(38 * FIXED + FIXED / 2);
    expect(s.y).toBe(29 * FIXED + FIXED / 2);
  });

  it("rejects an invalid appended waypoint atomically and lets plain orders or Hold clear the queue", () => {
    const m = match(),
      ownSquads = m.squads.filter((s) => s.playerId === 1);
    const issue = (tile: number, append = false) =>
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: ownSquads.map((s) => s.id),
        order: { type: "move", tile },
        append,
      });
    issue(m.map.ref(30, 25));
    issue(m.map.ref(40, 25), true);
    const before = m.snapshot().squads;
    expect(issue(-1, true)).toMatch(/passable/);
    expect(m.snapshot().squads).toEqual(before);
    expect(issue(m.map.ref(30, 30))).toBeNull();
    expect(ownSquads.every((s) => !s.queuedOrders.length)).toBe(true);
    issue(m.map.ref(40, 25), true);
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: ownSquads.map((s) => s.id),
        order: { type: "hold" },
      }),
    ).toBeNull();
    expect(
      ownSquads.every((s) => s.order.type === "hold" && !s.queuedOrders.length),
    ).toBe(true);
  });

  it("caps queues for the whole selection and proceeds after a queued target disappears", () => {
    const m = match(),
      s = m.squads[0],
      other = m.squads[1],
      enemy = m.squads.find((s) => s.playerId === 2)!;
    m.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [s.id],
      order: { type: "move", tile: m.map.ref(30, 25) },
    });
    for (let i = 0; i < MAX_QUEUED_ORDERS; i++)
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [s.id],
        order: { type: "move", tile: m.map.ref(30, 25) },
        append: true,
      });
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [other.id, s.id],
        order: { type: "move", tile: m.map.ref(40, 25) },
        append: true,
      }),
    ).toMatch(/32/);
    expect(other.order.type).toBe("hold");
    m.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [s.id],
      order: { type: "attack", targetId: enemy.id },
    });
    m.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [s.id],
      order: { type: "move", tile: m.map.ref(40, 25) },
      append: true,
    });
    m.squads.splice(m.squads.indexOf(enemy), 1);
    m.step();
    expect(s.order).toEqual({ type: "move", tile: m.map.ref(40, 25) });
    const snapshot = m.snapshot();
    snapshot.squads[0].queuedOrders.push({ type: "hold" });
    expect(s.queuedOrders).toHaveLength(0);
  });
});

describe("construction, recruitment, and economy", () => {
  it("charges gold once, blocks unfinished recruitment, and recruits the building's type", () => {
    const m = match();
    const b = build(m, "archery", 30, 25);
    expect(m.players[0].gold).toBe(10000 - BUILDING_RULES.archery.cost);
    const reserves = m.players[0].reserves;
    expect(
      m.applyCommand({ type: "recruit", playerId: 1, buildingId: b.id }),
    ).toMatch(/completed/);
    expect(m.players[0].reserves).toBe(reserves);
    step(m, BUILDING_RULES.archery.ticks);
    expect(
      m.applyCommand({ type: "recruit", playerId: 1, buildingId: b.id }),
    ).toBeNull();
    expect(m.squads[m.squads.length - 1].kind).toBe("archer");
    expect(m.squads[m.squads.length - 1].troops).toBe(1000);
    const stable = build(m, "stables", 38, 25);
    step(m, BUILDING_RULES.stables.ticks);
    expect(
      m.applyCommand({ type: "recruit", playerId: 1, buildingId: stable.id }),
    ).toBeNull();
    expect(m.squads[m.squads.length - 1].kind).toBe("cavalry");
    expect(account(m)).toBe(24000 + m.producedTroops);
  });

  it("rejects enemy land, overlap, inland ports, insufficient gold, and unknown types without spending", () => {
    const m = match(),
      before = m.players[0].gold;
    expect(
      m.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "city",
        tile: m.players[1].base,
      }),
    ).toMatch(/friendly/);
    expect(
      m.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "city",
        tile: m.players[0].base,
      }),
    ).toMatch(/same type/);
    own(m, m.map.ref(30, 25));
    expect(
      m.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "port",
        tile: m.map.ref(30, 25),
      }),
    ).toMatch(/water/);
    expect(
      m.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "unknown" as BuildingType,
        tile: m.map.ref(30, 25),
      }),
    ).toMatch(/Unknown/);
    expect(m.players[0].gold).toBe(before);
    m.players[0].gold = 0;
    expect(
      m.applyCommand({
        type: "build",
        playerId: 1,
        buildingType: "city",
        tile: m.map.ref(30, 25),
      }),
    ).toMatch(/gold/);
    expect(m.buildings).toHaveLength(2);
  });

  it("captured buildings change owner with construction progress intact and serve the new owner", () => {
    const m = match(),
      s = single(m),
      b = build(m, "stables", 30, 25);
    place(s, 15, 25);
    const enemy = m.squads[1];
    place(enemy, 30, 25);
    step(m, 30);
    expect(b.playerId).toBe(2);
    expect(b.remainingTicks).toBe(BUILDING_RULES.stables.ticks - 30);
    step(m, b.remainingTicks);
    expect(
      m.applyCommand({ type: "recruit", playerId: 1, buildingId: b.id }),
    ).toMatch(/friendly/);
    expect(
      m.applyCommand({ type: "recruit", playerId: 2, buildingId: b.id }),
    ).toBeNull();
    expect(m.squads[m.squads.length - 1].kind).toBe("cavalry");
  });

  it("cities and factories add their incomes only after completion", () => {
    const m = match();
    single(m);
    const city = build(m, "city", 30, 25),
      factory = build(m, "factory", 38, 25);
    const baseReserves = m.players[0].reserves,
      baseGold = m.players[0].gold;
    step(m, 20);
    expect(m.players[0].reserves - baseReserves).toBe(
      40 + Math.floor(m.players[0].land / 20),
    );
    expect(m.players[0].gold - baseGold).toBe(
      10 + Math.floor(m.players[0].land / 40),
    );
    m.updateBuilding((city).id, { remainingTicks: 0 });
    m.updateBuilding((factory).id, { remainingTicks: 0 });
    const beforeReserves = m.players[0].reserves,
      beforeGold = m.players[0].gold;
    step(m, 20);
    expect(m.players[0].reserves - beforeReserves).toBe(
      40 + Math.floor(m.players[0].land / 20) + 40,
    );
    expect(m.players[0].gold - beforeGold).toBe(
      10 + Math.floor(m.players[0].land / 40) + 20,
    );
  });
});

describe("squad classes and replenishment", () => {
  it("pauses replenishment when reserves are empty or the tile becomes hostile", () => {
    const m = match(),
      s = single(m);
    own(m, m.tileOf(s));
    s.troops = 900;
    m.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [s.id],
      order: { type: "replenish" },
    });
    m.players[0].reserves = 0;
    own(m, m.players[0].base, 2);
    m.tick = 19;
    m.step();
    expect(s.troops).toBe(900);
    m.players[0].reserves = 10;
    m.tick = 39;
    m.step();
    expect(s.troops).toBe(910);
    expect(m.players[0].reserves).toBe(0);
    m.players[0].reserves = 1000;
    own(m, m.tileOf(s), 2);
    m.tick = 59;
    m.step();
    expect(s.troops).toBe(910);
  });
  it("archers attack at range, weaken in melee, and cavalry moves faster", () => {
    const m = match(),
      archer = single(m),
      enemy = m.squads[1];
    archer.kind = "archer";
    place(enemy, 35, 25);
    step(m, 20);
    expect(enemy.troops).toBe(975);
    expect(archer.troops).toBe(1000);
    place(enemy, 31, 25);
    enemy.kind = "archer";
    enemy.troops = 1000;
    step(m, 20);
    expect(enemy.troops).toBe(990);
    expect(archer.troops).toBe(990);
    const before = m.movementSpeed(archer);
    archer.kind = "cavalry";
    expect(m.movementSpeed(archer)).toBeGreaterThan(before);
    place(enemy, 65, 35);
    archer.kind = "archer";
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [archer.id],
        order: { type: "attack", targetId: enemy.id },
      }),
    ).toBeNull();
    for (let i = 0; i < 600 && !archer.fighting; i++) m.step();
    expect(archer.fighting).toBe(true);
    expect(
      Math.abs(archer.x - enemy.x) + Math.abs(archer.y - enemy.y),
    ).toBeGreaterThan(FIXED * 2);
  });

  it("requires a manual order, friendly land, a combat delay, and reserve funds; movement cancels it", () => {
    const m = match(),
      s = single(m);
    own(m, m.tileOf(s));
    s.troops = 800;
    m.players[0].losses += 200;
    step(m, 20);
    expect(s.troops).toBe(800);
    s.lastCombatTick = m.tick;
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [s.id],
        order: { type: "replenish" },
      }),
    ).toBeNull();
    step(m, REPLENISH_DELAY - 1);
    expect(s.troops).toBe(800);
    const reserves = m.players[0].reserves,
      production = m.producedTroops;
    m.step();
    expect(s.troops).toBe(850);
    const playerProduction =
      m.producedTroops - production - (40 + Math.floor(m.players[1].land / 20));
    expect(m.players[0].reserves).toBe(reserves + playerProduction - 50);
    m.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [s.id],
      order: { type: "move", tile: m.map.ref(40, 25) },
    });
    step(m, 20);
    expect(s.troops).toBe(850);
    own(m, m.tileOf(s), 2);
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [s.id],
        order: { type: "replenish" },
      }),
    ).toMatch(/friendly/);
    expect(account(m)).toBe(24000 + m.producedTroops);
  });

  it("caps replenishment at 1,000 and stops after full strength; taking fire prevents healing", () => {
    const m = match(),
      s = single(m);
    own(m, m.tileOf(s));
    s.troops = 990;
    m.players[0].losses += 10;
    m.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [s.id],
      order: { type: "replenish" },
    });
    step(m, TICKS_PER_SECOND);
    expect(s.troops).toBe(1000);
    expect(s.order.type).toBe("hold");
    const enemy = m.squads[1];
    enemy.kind = "archer";
    place(enemy, 35, 25);
    s.troops = 800;
    m.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [s.id],
      order: { type: "replenish" },
    });
    step(m, 80);
    expect(s.troops).toBe(700);
    expect(s.lastCombatTick).toBe(m.tick);
  });
});

describe("archer volleys and positioning", () => {
  it("fires once a second while stationary and five times slower during actual movement", () => {
    const stationary = match(),
      moving = match();
    const still = single(stationary),
      walker = single(moving);
    still.kind = "archer";
    walker.kind = "archer";
    place(still, 28, 21);
    place(walker, 28, 21);
    place(stationary.squads[1], 32, 25);
    place(moving.squads[1], 32, 25);
    const corners = [
      [36, 21],
      [36, 29],
      [28, 29],
      [28, 21],
    ];
    corners.forEach(([x, y], i) =>
      expect(
        moving.applyCommand({
          type: "order",
          playerId: 1,
          squadIds: [walker.id],
          order: { type: "move", tile: moving.map.ref(x, y) },
          append: i > 0,
        }),
      ).toBeNull(),
    );
    const stationaryShots = new Set<number>(),
      movingShots = new Set<number>();
    for (let tick = 1; tick <= 100; tick++) {
      stationary.step();
      moving.step();
      expect(still.moved).toBe(false);
      expect(walker.moved).toBe(true);
      for (const volley of stationary.volleys) stationaryShots.add(volley.id);
      for (const volley of moving.volleys) movingShots.add(volley.id);
      if (tick === 19) {
        expect(stationary.squads[1].troops).toBe(1000);
        expect(stationary.volleys).toEqual([]);
      }
    }
    expect(stationaryShots.size).toBe(5);
    expect(movingShots.size).toBe(1);
    expect(stationary.squads[1].troops).toBe(875);
    expect(moving.squads[1].troops).toBe(975);
    expect(still.troops).toBe(1000);
    expect(walker.troops).toBe(1000);
  });

  it("stops an attack at the outer range, holds against approaching enemies, and follows escaping targets", () => {
    const m = match(),
      archer = single(m),
      enemy = m.squads[1];
    archer.kind = "archer";
    place(enemy, 50, 25);
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [archer.id],
        order: { type: "attack", targetId: enemy.id },
      }),
    ).toBeNull();
    for (let tick = 0; tick < 300 && !archer.fighting; tick++) m.step();
    const distance = Math.hypot(archer.x - enemy.x, archer.y - enemy.y);
    expect(distance).toBeLessThanOrEqual(6 * FIXED);
    expect(distance).toBeGreaterThanOrEqual(6 * FIXED - 1);
    const position = [archer.x, archer.y];
    step(m, 20);
    expect([archer.x, archer.y]).toEqual(position);
    expect(archer.moved).toBe(false);
    place(enemy, 49, 25);
    step(m, 20);
    expect([archer.x, archer.y]).toEqual(position);
    place(enemy, 60, 25);
    step(m, 100);
    expect([archer.x, archer.y]).not.toEqual(position);
    expect(
      Math.hypot(archer.x - enemy.x, archer.y - enemy.y),
    ).toBeLessThanOrEqual(6 * FIXED);
    expect(archer.order.type).toBe("attack");
  });

  it("publishes only released volleys, clones their snapshot data, and expires old arrows", () => {
    const m = match(),
      archer = single(m),
      enemy = m.squads[1];
    archer.kind = "archer";
    place(enemy, 35, 25);
    step(m, 19);
    expect(m.snapshot().volleys).toEqual([]);
    m.step();
    const shot = m.snapshot().volleys[0];
    expect(shot).toMatchObject({
      tick: 20,
      squadId: archer.id,
      playerId: 1,
      fromX: archer.x,
      fromY: archer.y,
      toX: enemy.x,
      toY: enemy.y,
    });
    shot.fromX = -1;
    expect(m.volleys[0].fromX).toBe(archer.x);
    place(enemy, 65, 35);
    step(m, 13);
    expect(m.volleys).toEqual([]);
    expect(archer.firingCharge).toBe(0);
  });
});

describe("naval transport and combat", () => {
  function navy() {
    const m = match(true),
      s = single(m),
      port = build(m, "port", 30, 8);
    m.updateBuilding((port).id, { remainingTicks: 0 });
    expect(
      m.applyCommand({
        type: "recruit-ship",
        playerId: 1,
        buildingId: port.id,
        shipType: "transport",
      }),
    ).toBeNull();
    const ship = m.ships[0];
    place(s, 30, 8);
    own(m, m.tileOf(s));
    return { m, s, ship, port };
  }

  it("moves both sides to a reachable coast, fills four slots, and holds excess squads ashore", () => {
    const { m, s, ship } = navy();
    for (let i = 0; i < 5; i++)
      expect(
        m.applyCommand({
          type: "recruit",
          playerId: 1,
          buildingId: m.buildings[0].id,
        }),
      ).toBeNull();
    const selected = m.squads.filter((unit) => unit.playerId === 1);
    selected.forEach((unit, i) => place(unit, 40 + i, 25));
    place(ship, 60, 4);
    const initial = { landX: s.x, landY: s.y, seaX: ship.x, seaY: ship.y };
    expect(
      m.applyCommand({
        type: "board",
        playerId: 1,
        shipId: ship.id,
        squadIds: selected.map((unit) => unit.id),
      }),
    ).toBeNull();
    const shore = ship.boarding!.landTile,
      sea = ship.boarding!.waterTile;
    const snapshot = m.snapshot();
    snapshot.ships[0].boarding!.squadIds.length = 0;
    expect(ship.boarding!.squadIds).toHaveLength(6);
    step(m, 10);
    expect(s.x !== initial.landX || s.y !== initial.landY).toBe(true);
    expect(ship.x !== initial.seaX || ship.y !== initial.seaY).toBe(true);
    step(m, 450);
    expect(selected.filter((unit) => unit.embarkedOn === ship.id)).toHaveLength(
      4,
    );
    const excess = selected.filter((unit) => unit.embarkedOn === null);
    expect(excess).toHaveLength(2);
    expect(
      excess.every(
        (unit) => unit.order.type === "hold" && unit.queuedOrders.length === 0,
      ),
    ).toBe(true);
    expect(
      excess.every(
        (unit) => m.map.euclideanDistSquared(m.tileOf(unit), shore) <= 9,
      ),
    ).toBe(true);
    expect(m.tileOf(ship)).toBe(sea);
    expect(ship.boarding).toBeNull();
    const positions = excess.map((unit) => [unit.x, unit.y]);
    step(m, 40);
    expect(excess.map((unit) => [unit.x, unit.y])).toEqual(positions);
    expect(account(m)).toBe(24000 + m.producedTroops);
  });

  it("preserves existing cargo and takes only the remaining whole-squad slots", () => {
    const { m, s, ship } = navy();
    expect(
      m.applyCommand({
        type: "load",
        playerId: 1,
        shipId: ship.id,
        squadIds: [s.id],
      }),
    ).toBeNull();
    for (let i = 0; i < 5; i++)
      m.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: m.buildings[0].id,
      });
    const selected = m.squads.filter(
      (unit) => unit.playerId === 1 && unit.embarkedOn === null,
    );
    selected.forEach((unit, i) => place(unit, 35 + i, 20));
    expect(
      m.applyCommand({
        type: "board",
        playerId: 1,
        shipId: ship.id,
        squadIds: selected.map((unit) => unit.id),
      }),
    ).toBeNull();
    step(m, 400);
    expect(s.embarkedOn).toBe(ship.id);
    expect(m.squads.filter((unit) => unit.embarkedOn === ship.id)).toHaveLength(
      4,
    );
    expect(selected.filter((unit) => unit.embarkedOn === null)).toHaveLength(2);
    expect(selected.every((unit) => unit.troops === 1000)).toBe(true);
    expect(account(m)).toBe(24000 + m.producedTroops);
  });

  it("validates selections and shared coast before replacing either side's orders", () => {
    const { m, s, ship } = navy();
    m.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [s.id],
      order: { type: "move", tile: m.map.ref(35, 20) },
    });
    m.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: [ship.id],
      tile: m.map.ref(40, 7),
    });
    const before = m.snapshot();
    const enemy = m.squads.find((unit) => unit.playerId === 2)!;
    expect(
      m.applyCommand({
        type: "board",
        playerId: 1,
        shipId: ship.id,
        squadIds: [s.id, enemy.id],
      }),
    ).toMatch(/your land squads/);
    expect(
      m.applyCommand({
        type: "board",
        playerId: 2,
        shipId: ship.id,
        squadIds: [enemy.id],
      }),
    ).toMatch(/your transport/);
    expect(m.snapshot()).toEqual(before);
    const terrain = new Uint8Array(80 * 50).fill(133);
    for (let y = 0; y < 50; y++)
      for (let x = 38; x <= 41; x++) terrain[y * 80 + x] = 0;
    const islands = new Skirmish(
      new GameMapImpl(80, 50, terrain, terrain.length),
      { seed: 42, aiCount: 1, runAi: false },
    );
    const port = build(islands, "port", 37, 20);
    islands.updateBuilding(port.id, { remainingTicks: 0 });
    islands.applyCommand({
      type: "recruit-ship",
      playerId: 1,
      buildingId: port.id,
      shipType: "transport",
    });
    const units = islands.squads.filter((unit) => unit.playerId === 1);
    place(units[0], 30, 20);
    place(units[1], 45, 20);
    const old = islands.snapshot();
    expect(
      islands.applyCommand({
        type: "board",
        playerId: 1,
        shipId: islands.ships[0].id,
        squadIds: units.slice(0, 2).map((unit) => unit.id),
      }),
    ).toMatch(/shared reachable coast/);
    expect(islands.snapshot()).toEqual(old);
  });

  it("lets new ship and squad orders cancel the rendezvous without later surprise boarding", () => {
    const { m, s, ship } = navy();
    place(s, 40, 25);
    const board = () =>
      expect(
        m.applyCommand({
          type: "board",
          playerId: 1,
          shipId: ship.id,
          squadIds: [s.id],
        }),
      ).toBeNull();
    board();
    m.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: [ship.id],
      tile: m.map.ref(50, 7),
    });
    expect(ship.boarding).toBeNull();
    expect(s.order.type).toBe("hold");
    board();
    m.applyCommand({ type: "stop-ships", playerId: 1, shipIds: [ship.id] });
    expect(ship.boarding).toBeNull();
    expect(s.order.type).toBe("hold");
    board();
    m.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [s.id],
      order: { type: "hold" },
    });
    step(m, 400);
    expect(ship.boarding).toBeNull();
    expect(ship.destination).toBeNull();
    expect(s.embarkedOn).toBeNull();
  });

  it("releases unembarked squads when their rendezvous transport sinks", () => {
    const { m, s, ship } = navy();
    place(s, 40, 25);
    m.applyCommand({
      type: "board",
      playerId: 1,
      shipId: ship.id,
      squadIds: [s.id],
    });
    const port = build(m, "port", 40, 8, 2);
    m.updateBuilding((port).id, { remainingTicks: 0 });
    m.applyCommand({
      type: "recruit-ship",
      playerId: 2,
      buildingId: port.id,
      shipType: "warship",
    });
    place(m.ships[1], 32, 7);
    ship.health = 1;
    m.step();
    expect(m.ships.some((unit) => unit.id === ship.id)).toBe(false);
    expect(s.embarkedOn).toBeNull();
    expect(s.order.type).toBe("hold");
    expect(s.queuedOrders).toEqual([]);
    expect(account(m)).toBe(24000 + m.producedTroops);
  });

  it("launches only from a ready owned port and charges gold; ships cannot sail on land", () => {
    const { m, ship, port } = navy();
    const gold = m.players[0].gold;
    expect(
      m.applyCommand({
        type: "recruit-ship",
        playerId: 1,
        buildingId: port.id,
        shipType: "warship",
      }),
    ).toBeNull();
    expect(m.players[0].gold).toBe(gold - SHIP_RULES.warship.cost);
    expect(
      m.applyCommand({
        type: "sail",
        playerId: 1,
        shipIds: [ship.id],
        tile: port.tile,
      }),
    ).toMatch(/water/);
    expect(
      m.applyCommand({
        type: "sail",
        playerId: 2,
        shipIds: [ship.id],
        tile: m.map.ref(40, 7),
      }),
    ).toMatch(/own ships/);
    m.updateBuilding((port).id, { remainingTicks: 1 });
    expect(
      m.applyCommand({
        type: "recruit-ship",
        playerId: 1,
        buildingId: port.id,
        shipType: "warship",
      }),
    ).toMatch(/completed/);
  });

  it("embarks squads, follows queued sea waypoints, and lands them on a hostile coast without duplicating troops", () => {
    const { m, s, ship } = navy();
    expect(
      m.applyCommand({
        type: "load",
        playerId: 1,
        shipId: ship.id,
        squadIds: [s.id],
      }),
    ).toBeNull();
    expect(s.embarkedOn).toBe(ship.id);
    m.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: [ship.id],
      tile: m.map.ref(34, 7),
    });
    m.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: [ship.id],
      tile: m.map.ref(40, 7),
      append: true,
    });
    const hostile = m.map.ref(40, 8);
    own(m, hostile, 2);
    step(m, 100);
    expect(ship.destination).toBeNull();
    expect(m.tileOf(ship)).toBe(m.map.ref(40, 7));
    expect(m.owners[hostile]).toBe(2);
    expect(s.troops).toBe(1000);
    expect(
      m.applyCommand({
        type: "unload",
        playerId: 1,
        shipId: ship.id,
        tile: hostile,
      }),
    ).toBeNull();
    expect(s.embarkedOn).toBeNull();
    expect(m.tileOf(s)).toBe(hostile);
    step(m, 30);
    expect(m.owners[hostile]).toBe(1);
    expect(account(m)).toBe(24000 + m.producedTroops);
  });

  it("rejects remote loading and overloaded cargo without partially embarking squads", () => {
    const { m, s, ship } = navy();
    place(s, 45, 25);
    expect(
      m.applyCommand({
        type: "load",
        playerId: 1,
        shipId: ship.id,
        squadIds: [s.id],
      }),
    ).toMatch(/three tiles/);
    expect(s.embarkedOn).toBeNull();
    place(s, 30, 8);
    const reserves = m.players[0].reserves;
    for (let i = 0; i < 4; i++) {
      m.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: m.buildings[0].id,
      });
      const added = m.squads[m.squads.length - 1];
      place(added, 30, 8);
    }
    expect(m.players[0].reserves).toBe(reserves - 4000);
    const selected = m.squads.filter((s) => s.playerId === 1);
    expect(
      m.applyCommand({
        type: "load",
        playerId: 1,
        shipId: ship.id,
        squadIds: selected.map((s) => s.id),
      }),
    ).toMatch(/4 squads/);
    expect(selected.every((s) => s.embarkedOn === null)).toBe(true);
  });

  it("warships fire simultaneously, sink transports, and account for all embarked casualties", () => {
    const { m, s, ship } = navy();
    m.applyCommand({
      type: "load",
      playerId: 1,
      shipId: ship.id,
      squadIds: [s.id],
    });
    const enemyPort = build(m, "port", 40, 8, 2);
    m.updateBuilding((enemyPort).id, { remainingTicks: 0 });
    m.applyCommand({
      type: "recruit-ship",
      playerId: 2,
      buildingId: enemyPort.id,
      shipType: "warship",
    });
    const enemyShip = m.ships[1];
    place(enemyShip, 32, 7);
    ship.health = 8;
    const before = account(m),
      production = m.producedTroops,
      losses = m.players[0].losses;
    m.step();
    expect(m.ships.some((b) => b.id === ship.id)).toBe(false);
    expect(m.squad(s.id)).toBeUndefined();
    expect(m.players[0].losses).toBe(losses + 1000);
    expect(account(m)).toBe(before + m.producedTroops - production);
    const friendlyPort = m.buildings.find(
      (b) => b.playerId === 1 && b.type === "port",
    )!;
    m.applyCommand({
      type: "recruit-ship",
      playerId: 1,
      buildingId: friendlyPort.id,
      shipType: "warship",
    });
    const friendlyShip = m.ships.find((b) => b.playerId === 1)!;
    friendlyShip.health = 1;
    enemyShip.health = 1;
    place(friendlyShip, 30, 7);
    place(enemyShip, 32, 7);
    m.step();
    expect(m.ships).toHaveLength(0);
  });
});
