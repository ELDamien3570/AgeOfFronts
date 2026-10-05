import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { VESSELS } from "../../src/skirmish/content/Units";
import {
  combatAdvantage,
  combatCohorts,
} from "../../src/skirmish/domain/AiCombatPower";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { tradePayout } from "../../src/skirmish/domain/TradeQuote";
import {
  navalInterceptTile,
  navalLocalRoute,
} from "../../src/skirmish/NavalLocalRoute";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SpatialGrid } from "../../src/skirmish/SpatialGrid";
function fixture(sea = false) {
  const data = new Uint8Array(140 * 90).fill(133);
  if (sea) data.fill(0, 30 * 140, 80 * 140);
  const map = new GameMapImpl(140, 90, data, data.length),
    game = new Skirmish(map, {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
      aiWarPolicy: true,
      aiEconomy: true,
      deferredPlanning: true,
    });
  const player = game.players[1],
    e = game.expansion!;
  player.base = map.ref(30, 15);
  player.reserves = 5000;
  game.owners.fill(player.id);
  const template = structuredClone(game.squads[0]);
  for (const s of [...game.squads]) game.removeSquad(s.id);
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  const add = (definitionId = "stoneage-infantry", x = 30, owner = player.id) =>
    game.addSquad({
      ...template,
      id: game.allocateId(),
      playerId: owner,
      kind: "infantry",
      definitionId,
      x: (x + 0.5) * FIXED,
      y: 15.5 * FIXED,
      troops: 1000,
      order: { type: "hold" },
      queuedOrders: [],
      path: [],
      nextPathIndex: 0,
      moved: false,
      fighting: false,
      embarkedOn: null,
    });
  const ship = (owner = 1, x = 30) =>
    game.addShip({
      id: game.allocateId(),
      playerId: owner,
      kind: "warship",
      definitionId: "stoneage-warship",
      x: (x + 0.5) * FIXED,
      y: 40.5 * FIXED,
      health: 1000,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
      boarding: null,
      repairState: "patrolling",
      patrolTile: map.ref(x, 40),
    });
  if (sea) {
    add("stoneage-infantry", 5, 1);
    add("stoneage-infantry", 120, player.id);
  }
  return { game, map, player, e, add, ship };
}
describe("responsive AI and naval movement", () => {
  it("cuts across a known merchant lane instead of only following a faster ship's stern", () => {
    const f = fixture(true),
      path = Array.from({ length: 16 }, (_, i) => f.map.ref(40 + i, 40));
    const goal = navalInterceptTile(
      f.map,
      { x: 44.5 * FIXED, y: 42.5 * FIXED, speed: 55 },
      { x: 40.5 * FIXED, y: 40.5 * FIXED, speed: 70, path, nextPathIndex: 1 },
      FIXED,
      f.map.ref(44, 42),
    );
    expect(f.map.x(goal)).toBeGreaterThan(40);
    expect(f.map.y(goal)).toBe(40);
    expect(
      navalLocalRoute(f.map, f.game.waterPaths, f.map.ref(44, 42), goal),
    ).toBeDefined();
  });

  it("keeps strategic sleep facts identical across restore despite index rebuilds", () => {
    const f = fixture();
    f.add();
    f.add();
    for (let i = 0; i < 8; i++) f.add("bronzeage-infantry", 60, 1);
    f.game.players[0].base = f.map.ref(60, 15);
    const forces = new Map([
      [1, 8],
      [f.player.id, 2],
    ]);
    for (const tick of [1200, 1300]) {
      f.game.tick = tick;
      f.e.operations.step(forces);
    }
    const clone = new Skirmish(f.map, f.game.options);
    clone.restore(f.game.checkpoint());
    f.game.tick = 1400;
    clone.tick = 1400;
    f.e.operations.step(forces);
    clone.expansion!.operations.step(forces);
    expect(clone.expansion!.operations.checkpoint()).toEqual(
      f.e.operations.checkpoint(),
    );
  });
  it("rotates crowded naval samples while respecting the record-read ceiling", () => {
    const grid = new SpatialGrid<{ x: number; y: number; enemy: boolean }>(
      100,
      100,
      10,
    );
    grid.rebuild(
      Array.from({ length: 600 }, (_, i) => ({ x: 5, y: 5, enemy: i >= 550 })),
    );
    const result: { x: number; y: number; enemy: boolean }[] = [];
    const accept = vi.fn((row: { enemy: boolean }) => row.enemy);
    grid.sample(5, 5, 4, result, accept, 32, 256, 0);
    expect(result).toHaveLength(0);
    expect(accept).toHaveBeenCalledTimes(256);
    accept.mockClear();
    grid.sample(5, 5, 4, result, accept, 32, 256, 512);
    expect(result).toHaveLength(32);
    expect(accept.mock.calls.length).toBeLessThanOrEqual(256);
  });

  it("responds before Armies research, immediately issues a bounded batch, and protects manual control", () => {
    const f = fixture(),
      units = Array.from({ length: 50 }, (_, i) =>
        f.add("stoneage-infantry", 30 + (i % 30)),
      );
    f.game.addBuilding({
      id: f.game.allocateId(),
      type: "city",
      playerId: f.player.id,
      tile: f.player.base,
      remainingTicks: 0,
      health: 1000,
    });
    const manual = units[0],
      assets = f.e.economy.assets;
    assets.acquire([
      {
        asset: `squad:${manual.id}`,
        playerId: f.player.id,
        generation: f.game.aiGeneration(f.player.id),
        controller: "manual-fixture",
        priority: "manual",
        createdTick: 0,
        expiresTick: 1000,
      },
    ]);
    f.e.operations.threatened(f.player.id, 1, f.map.ref(40, 15));
    const response = f.e.economy.military.armyPlanner.invasion,
      apply = vi.spyOn(f.game, "applyCommand");
    expect(f.e.armies.capacity(f.player.id)).toBe(0);
    expect(response.step(f.player, 8, () => {})).toBe(8);
    expect(apply.mock.calls.some(([c]) => c.type === "order")).toBe(true);
    for (let i = 0; i < 7; i++) response.step(f.player, 8, () => {});
    expect(
      [...assets.leases.values()].filter(
        (l) => l.controller === `invasion:${f.player.id}`,
      ),
    ).toHaveLength(49);
    expect(assets.leases.get(`squad:${manual.id}`)?.controller).toBe(
      "manual-fixture",
    );
    const saved = f.game.checkpoint();
    f.game.restore(saved);
    expect(f.game.checkpoint()).toEqual(saved);
    f.game.tick = 601;
    response.step(f.game.players[1], 8, () => {});
    expect(response.active(f.player.id)).toBe(false);
    expect(assets.held(`squad:${units[1].id}`)).toBe(false);
  });
  it("scores authored armor, weapon counters, health and veterancy rather than squad counts", () => {
    const f = fixture(),
      advanced = [
        f.add("earlymedieval-infantry"),
        f.add("earlymedieval-infantry"),
      ],
      bronze = Array.from({ length: 8 }, () =>
        f.add("bronzeage-infantry", 60, 1),
      );
    const compare = () =>
      combatAdvantage(combatCohorts(f.e, advanced), combatCohorts(f.e, bronze));
    expect(compare()).toBeGreaterThan(1.25);
    const strong = compare();
    for (const s of advanced) f.game.updateSquad(s.id, { troops: 100 });
    expect(compare()).toBeLessThan(strong);
    expect(combatAdvantage([], combatCohorts(f.e, bronze))).toBe(0);
  });
  it("takes a two-squad superior-age opportunity against a larger obsolete army", () => {
    const f = fixture();
    f.player.personalityId = "balanced";
    f.add("earlymedieval-infantry");
    f.add("earlymedieval-infantry");
    for (let i = 0; i < 8; i++) f.add("bronzeage-infantry", 60, 1);
    f.game.players[0].base = f.map.ref(60, 15);
    const forces = new Map([
      [1, 8],
      [f.player.id, 2],
    ]);
    for (const tick of [1200, 1260, 1500, 1560]) {
      f.game.tick = tick;
      f.e.operations.step(forces);
    }
    expect(f.e.operations.state(f.player.id)?.phase).toBe("war");
    expect(f.e.operations.offensiveTarget(f.player.id)).toBe(1);
  });
  it("staggers quiet patrol at half duty without global route searches, and preserves a pending manual voyage", () => {
    const f = fixture(true),
      s = f.ship(),
      find = vi.spyOn(f.game.waterPaths, "find");
    let moving = 0;
    for (let i = 0; i < 400; i++) {
      const old = f.game.ship(s.id)!;
      const x = old.x,
        y = old.y;
      f.game.step();
      const next = f.game.ship(s.id)!;
      if (next.x !== x || next.y !== y) moving++;
    }
    expect(moving).toBeGreaterThan(175);
    expect(moving).toBeLessThan(225);
    expect(find).not.toHaveBeenCalled();
    const goal = f.map.ref(100, 60);
    expect(
      f.game.applyCommand({
        type: "sail",
        playerId: 1,
        shipIds: [s.id],
        tile: goal,
      }),
    ).toBeNull();
    const pending = f.game.shipAdmission.replacement(s.id);
    expect(pending).toBeDefined();
    f.game.step();
    expect(f.game.shipAdmission.replacement(s.id)).toBe(pending);
    for (
      let i = 0;
      i < 40 && f.game.shipAdmission.replacement(s.id) !== undefined;
      i++
    )
      f.game.step();
    expect(f.game.ship(s.id)?.destination).toBe(goal);
  });
  it("actively approaches nearby hostile vessels but never diverts repair voyages", () => {
    const f = fixture(true),
      own = f.ship(),
      target = f.ship(f.player.id, 40),
      startX = own.x;
    f.game.players[1].ai = false;
    for (let i = 0; i < 12; i++) f.game.step();
    expect(f.game.ship(own.id)?.navalTargetId).toBe(target.id);
    expect(f.game.ship(own.id)?.x).toBeGreaterThan(startX);
    const port = f.game.addBuilding({
      id: f.game.allocateId(),
      type: "port",
      playerId: 1,
      tile: f.map.ref(30, 29),
      remainingTicks: 0,
      health: 1000,
    });
    f.game.owners[port.tile] = 1;
    f.game.updateShip(own.id, {
      repairState: "returning-to-dock",
      repairPortId: port.id,
      navalTargetId: undefined,
    });
    for (let i = 0; i < 12; i++) f.game.step();
    expect(f.game.ship(own.id)?.navalTargetId).toBeUndefined();
  });
  it("local connectors cannot cross land or exceed their work limit", () => {
    const f = fixture(true),
      start = f.map.ref(10, 40),
      goal = f.map.ref(20, 45);
    const route = navalLocalRoute(f.map, f.game.waterPaths, start, goal)!;
    expect(route[route.length - 1]).toBe(goal);
    expect(route.every((t) => f.game.waterPaths.walkable(t))).toBe(true);
    expect(
      navalLocalRoute(f.map, f.game.waterPaths, start, f.map.ref(100, 40)),
    ).toBeUndefined();
    expect(
      navalLocalRoute(f.map, f.game.waterPaths, start, f.map.ref(20, 15)),
    ).toBeUndefined();
  });
});
describe("successful long sea trade contract", () => {
  it.each(AGES)(
    "pays a bounded 1.5 times land value per good on long sea voyages in %s",
    (age) => {
      const vessel = VESSELS.find((v) => v.kind === "trade" && v.age === age)!;
      const width = 1000,
        seaCargo = vessel.capacity!,
        distance = 300;
      const land = tradePayout({
        naval: false,
        quantity: seaCargo,
        valuePerGood: 10,
        distance: 50,
        foreign: true,
        allied: false,
      });
      const sea = tradePayout({
        naval: true,
        quantity: seaCargo,
        valuePerGood: 10,
        distance,
        routeTiles: distance,
        foreign: true,
        allied: false,
        mapWidth: width,
        seaSpeed: vessel.speed,
      });
      expect(sea / land).toBeCloseTo(1.5, 2);
    },
  );
  it("ignores detours, scales partial cargo, and allows journey time to outweigh the voyage premium", () => {
    const base = {
      naval: true,
      quantity: 100,
      valuePerGood: 10,
      distance: 300,
      foreign: true,
      allied: false,
      mapWidth: 1000,
      seaSpeed: 106,
      referenceCargoRatio: 1.5,
    };
    expect(tradePayout({ ...base, routeTiles: 100000 })).toBe(
      tradePayout({ ...base, routeTiles: 2000 }),
    );
    expect(
      Math.abs(tradePayout({ ...base, quantity: 50 }) - tradePayout(base) / 2),
    ).toBeLessThan(1);
    const income = (d: number) =>
      tradePayout({ ...base, distance: d }) / (60 + (2 * d * FIXED) / 106);
    expect(tradePayout({...base,distance:2})).toBeLessThan(tradePayout({...base,distance:50}));
    expect(tradePayout({...base,distance:50})).toBeLessThan(tradePayout(base));
    expect(income(2)).toBeGreaterThan(income(50));
    expect(income(50)).toBeGreaterThan(income(300));
  });
});
