import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { buildingCost } from "../../src/skirmish/content/Buildings";
import {
  TECHNOLOGIES,
  TECHNOLOGY,
} from "../../src/skirmish/content/Technology";
import { UNITS } from "../../src/skirmish/content/Units";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { stepBombardment } from "../../src/skirmish/domain/AiNavalBombardment";
import type { AiFleetMission } from "../../src/skirmish/domain/AiNavalPlanner";
import {
  researchUtility,
  usableNextAge,
} from "../../src/skirmish/domain/AiResearchUtility";
import { flankCandidate } from "../../src/skirmish/domain/AiTacticalRoutes";
import {
  tradeCycleQuote,
  tradePayout,
} from "../../src/skirmish/domain/TradeQuote";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { tilePoint } from "../../src/skirmish/SquadGeometry";

function fixture(water = false) {
  const terrain = new Uint8Array(96 * 64).fill(133);
  if (water)
    for (let y = 20; y < 64; y++) terrain.fill(0, y * 96, (y + 1) * 96);
  const map = new GameMapImpl(96, 64, terrain, water ? 1920 : terrain.length);
  const game = new Skirmish(map, {
    seed: 42,
    aiCount: 1,
    tribes: false,
    ruleset: "ages-v1",
    runAi: false,
    aiEconomy: true,
    aiNaval: true,
    deferredPlanning: true,
  });
  const player = game.players[1],
    e = game.expansion!;
  player.base = map.ref(60, 10);
  player.gold = 100000;
  player.reserves = 10000;
  game.owners.fill(player.id);
  const state = e.progression.states[player.id];
  state.completed = TECHNOLOGIES.filter(
    (t) => t.age === "StoneAge" || t.age === "BronzeAge",
  ).map((t) => t.id);
  const template = game.squads.find((s) => s.playerId === player.id)!;
  const add = (
    definitionId = "stoneage-infantry",
    x = 60,
    y = 10,
    owner = player.id,
  ): Squad =>
    game.addSquad({
      ...template,
      id: game.allocateId(),
      playerId: owner,
      definitionId,
      kind: UNITS.find((u) => u.id === definitionId)!.line,
      x: (x + 0.5) * FIXED,
      y: (y + 0.5) * FIXED,
      troops: 1000,
      order: { type: "hold" },
      queuedOrders: [],
      path: [],
      embarkedOn: null,
      refit: null,
      structureTarget: null,
    });
  const building = (
    owner: number,
    type: "port" | "factory" | "city" | "barracks" | "tower",
    x: number,
    y: number,
  ) =>
    game.addBuilding({
      id: game.allocateId(),
      playerId: owner,
      type,
      tile: map.ref(x, y),
      age: "StoneAge",
      remainingTicks: 0,
      health: 1000,
    });
  const ship = (owner = player.id, x = 60, y = 21) =>
    game.addShip({
      id: game.allocateId(),
      playerId: owner,
      kind: "warship",
      definitionId: "stoneage-warship",
      x: (x + 0.5) * FIXED,
      y: (y + 0.5) * FIXED,
      health: 1000,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
      boarding: null,
      repairState: "patrolling",
    });
  return {
    game,
    map,
    e,
    get player() {
      return game.players[1];
    },
    add,
    building,
    ship,
  };
}
afterEach(() => vi.restoreAllMocks());
describe("remaining strategic plans", () => {
  it("resumes exact strategic quotes after checkpoint without synchronous searches", () => {
    const f = fixture(),
      start = f.map.ref(20, 10),
      goal = f.map.ref(50, 10);
    const find = vi.spyOn(f.game.paths, "find");
    expect(
      f.e.economy.routes.request("test", f.player.id, start, goal).pending,
    ).toBe(true);
    f.game.restore(f.game.checkpoint());
    let result = f.e.economy.routes.request("test", f.player.id, start, goal);
    for (let n = 0; n < 100 && result.pending; n++) {
      f.game.routePlanner.step(++f.game.tick);
      result = f.e.economy.routes.request("test", f.player.id, start, goal);
    }
    expect(result.path?.[result.path.length - 1]).toBe(goal);
    expect(find).not.toHaveBeenCalled();
    f.e.economy.routes.release("test");
    expect(f.e.economy.routes.checkpoint().quotes).toHaveLength(0);
  });
  it("bounds strategic quote storage and rejects a changed generation", () => {
    const f = fixture(),
      routes = f.e.economy.routes;
    for (let n = 0; n < 64; n++)
      routes.request(
        `q${n}`,
        f.player.id,
        f.map.ref(20, 10),
        f.map.ref(50, 10),
      );
    expect(
      routes.request(
        "overflow",
        f.player.id,
        f.map.ref(20, 10),
        f.map.ref(50, 10),
      ),
    ).toMatchObject({ pending: false });
    expect(routes.checkpoint().quotes).toHaveLength(64);
    routes.releasePlayer(f.player.id);
    expect(routes.checkpoint().quotes).toHaveLength(0);
  });
  it("generates genuine left and right side routes with a finite candidate limit", () => {
    const f = fixture(),
      origin = tilePoint(f.map, f.map.ref(20, 10)),
      target = tilePoint(f.map, f.map.ref(40, 10));
    const left = flankCandidate(f.map, origin, target, 0, -1)!,
      right = flankCandidate(f.map, origin, target, 0, 1)!;
    expect(f.map.y(left)).toBeLessThan(10);
    expect(f.map.y(right)).toBeGreaterThan(10);
    expect(flankCandidate(f.map, origin, target, 12, -1)).toBeUndefined();
  });
  it("takes an exact reachable flank and invalidates it when the target moves", () => {
    const f = fixture(),
      own = [
        f.add(),
        f.add("stoneage-infantry", 61),
        f.add("stoneage-cavalry", 62),
      ];
    f.player.personalityId = "rider";
    const enemy = f.add("stoneage-infantry", 70, 10, 1);
    f.game.restore(f.game.checkpoint());
    expect(
      f.game.applyCommand({
        type: "create-army",
        playerId: f.player.id,
        squadIds: own.map((s) => s.id),
      }),
    ).toBeNull();
    const army = f.e.armies.armyOf(own[0].id)!,
      planner = f.e.economy.military.armyPlanner,
      id = "flank-fixture";
    const plan = {
      id,
      playerId: f.player.id,
      generation: f.game.aiGeneration(f.player.id),
      phase: "flank" as const,
      created: 0,
      since: 0,
      deadline: 3000,
      nextThink: 0,
      cursor: 0,
      rosterIds: own.map((s) => s.id),
      members: own.map((s) => s.id),
      armyId: army.id,
      target: 1,
      targetTile: f.map.ref(70, 10),
      initialTroops: 3000,
      reason: "fixture",
      maneuver: {
        enemy: enemy.id,
        targetTile: f.map.ref(70, 10),
        start: f.map.ref(60, 10),
        cursor: 0,
        since: 0,
        tile: undefined as number | undefined,
      },
    };
    planner.objectives.set(f.player.id, plan);
    f.e.economy.assets.acquire(
      own.map((s) => ({
        asset: `squad:${s.id}` as const,
        playerId: f.player.id,
        generation: plan.generation,
        controller: id,
        priority: "operation" as const,
        createdTick: 0,
        expiresTick: 3000,
      })),
    );
    for (let n = 0; n < 10 && !plan.maneuver.tile; n++) {
      f.game.tick += 40;
      f.game.routePlanner.step(f.game.tick);
      expect(planner.step(8)).toBeLessThanOrEqual(8);
    }
    expect(plan.maneuver.tile).toBeDefined();
    for (let n = 0; n < 150 && army.order.type === "hold"; n++) {
      f.game.routePlanner.step(++f.game.tick);
      f.e.armies.stepPlanning(128);
    }
    expect(army.order.type).toBe("move");
    f.game.updateSquad(enemy.id, { x: 85.5 * FIXED });
    f.game.tick += 40;
    planner.step(8);
    expect(planner.objectives.get(f.player.id)?.phase).toBe("advance");
  });
  it("chooses missing ranged capability and avoids landlocked naval research", () => {
    const f = fixture(),
      state = f.e.progression.states[f.player.id];
    state.age = "StoneAge";
    state.completed = [
      "stoneage-flint-weapons",
      "stoneage-gathering",
      "stoneage-cargo-canoes",
    ];
    const snapshot = economicSnapshot({
      player: f.player,
      tick: 0,
      generation: 0,
      age: state.age,
      research: state.completed,
      inventory: {},
      buildings: f.game.buildings,
      squads: [],
      ships: [],
      jobs: [],
      production: {},
      cap: 20,
      threatTroops: 0,
    });
    const demand = { units: { ranged: 4 }, equipment: {}, materials: {} },
      opportunity = {
        resources: [],
        usableCoast: false,
        seaThreat: 0,
        goods: 0,
        protectedItems: {},
      };
    expect(
      researchUtility(
        TECHNOLOGY.get("stoneage-spear-throwing")!,
        snapshot,
        demand,
        opportunity,
      ).benefit,
    ).toBeGreaterThan(5000);
    expect(
      researchUtility(
        TECHNOLOGY.get("stoneage-war-canoes")!,
        snapshot,
        demand,
        opportunity,
      ).benefit,
    ).toBe(0);
  });
  it("requires a viable paid production path before an age transition", () => {
    const f = fixture(),
      state = f.e.progression.states[f.player.id];
    state.age = "StoneAge";
    f.building(f.player.id, "barracks", 60, 10);
    const snapshot = economicSnapshot({
      player: f.player,
      tick: 0,
      generation: 0,
      age: state.age,
      research: state.completed,
      inventory: {},
      buildings: f.game.buildingFacts().byOwner(f.player.id),
      squads: [],
      ships: [],
      jobs: [],
      production: {},
      cap: 20,
      threatTroops: 0,
    });
    const opportunity = {
      resources: [],
      usableCoast: false,
      seaThreat: 0,
      goods: 0,
      protectedItems: {},
    };
    expect(usableNextAge(snapshot, opportunity)).toBe(false);
    expect(
      usableNextAge(snapshot, { ...opportunity, resources: ["copper", "tin"] }),
    ).toBe(true);
  });
  it("quotes a complete safe cycle using settlement pricing, physical capacity and returned cargo", () => {
    const legs = [
      {
        marketId: 1,
        distance: 80,
        foreign: true,
        allied: true,
        travelTicks: 400,
      },
      {
        marketId: 2,
        distance: 40,
        foreign: true,
        allied: false,
        travelTicks: 200,
      },
    ];
    const quote = tradeCycleQuote({
      naval: true,
      stock: 100,
      capacity: 25,
      valuePerGood: 100,
      supplyTicks: 0,
      legs,
      returnTicks: 600,
      observedRisk: 0,
    });
    expect(quote.guaranteedGold).toBe(
      legs.reduce(
        (n, l) =>
          n +
          tradePayout({ ...l, naval: true, quantity: 10, valuePerGood: 100 }),
        0,
      ),
    );
    expect(quote).toMatchObject({
      quantity: 25,
      delivered: 20,
      returned: 5,
      handlingTicks: 80,
      travelTicks: 1200,
      cycleTicks: 1280,
    });
    expect(quote.riskAdjustedGoldPer1000Ticks).toBe(quote.goldPer1000Ticks);
    expect(
      tradeCycleQuote({
        naval: true,
        stock: 100,
        capacity: 25,
        valuePerGood: 100,
        supplyTicks: 0,
        legs,
        returnTicks: 600,
        observedRisk: 500,
      }).riskAdjustedGoldPer1000Ticks,
    ).toBeLessThan(quote.goldPer1000Ticks);
  });
  it("does not pay a domestic sea market or visit the same market twice", () => {
    const quote = tradeCycleQuote({
      naval: true,
      stock: 40,
      capacity: 40,
      valuePerGood: 50,
      supplyTicks: 0,
      returnTicks: 100,
      observedRisk: 0,
      legs: [
        {
          marketId: 1,
          distance: 40,
          foreign: false,
          allied: false,
          travelTicks: 100,
        },
        {
          marketId: 2,
          distance: 40,
          foreign: true,
          allied: false,
          travelTicks: 100,
        },
        {
          marketId: 2,
          distance: 40,
          foreign: true,
          allied: false,
          travelTicks: 100,
        },
      ],
    });
    expect(quote.delivered).toBe(10);
    expect(quote.returned).toBe(30);
  });
  it("finds a useful neutral coast but does not fabricate ownership or pay before occupation", () => {
    const f = fixture(true),
      tile = f.map.ref(60, 19);
    for (let n = 0; n < 6; n++)
      f.add("stoneage-infantry", 59 + (n % 3), 10 + Math.floor(n / 3));
    f.game.owners[tile] = 0;
    f.building(1, "port", 80, 19);
    f.game.restore(f.game.checkpoint());
    for (let n = 0; n < 100; n++) f.e.economy.navalFacts.step(f.game.tick, 32);
    const controller = f.e.economy.coasts;
    controller.goals.set(f.player.id, {
      id: "coast-fixture",
      playerId: f.player.id,
      generation: f.game.aiGeneration(f.player.id),
      phase: "quote",
      cursor: 0,
      index: 0,
      shortlist: [
        {
          tile,
          water: f.map.ref(60, 20),
          sea: f.game.waterPaths.component[f.map.ref(60, 20)],
          score: 5000,
        },
      ],
      members: [],
      created: 0,
      deadline: 6000,
      nextThink: 0,
      reason: "fixture",
    });
    const before = f.player.gold;
    for (
      let n = 0;
      n < 50 && controller.goals.get(f.player.id)?.phase === "quote";
      n++
    ) {
      f.game.tick++;
      f.game.routePlanner.step(f.game.tick);
      expect(controller.step(4)).toBeLessThanOrEqual(4);
    }
    expect(controller.goals.get(f.player.id)?.phase).toBe("move");
    expect(f.game.owners[tile]).toBe(0);
    expect(f.player.gold).toBe(before);
    const restored = controller.checkpoint();
    f.game.restore(f.game.checkpoint());
    expect(controller.checkpoint()).toEqual(restored);
    const goal = controller.goals.get(f.player.id)!;
    f.game.removeSquad(goal.members[0]);
    f.game.tick = 100;
    controller.step(4);
    controller.step(4);
    expect(controller.goals.get(f.player.id)?.phase).toBe("abort");
    expect(f.player.gold).toBe(before);
  });
  it("closes a landlocked coast scan within the allowance", () => {
    const f = fixture(),
      controller = f.e.economy.coasts;
    for (let n = 0; n < 4; n++)
      expect(controller.step(1)).toBeLessThanOrEqual(1);
    expect(controller.goals.get(f.player.id)?.phase).toBe("abort");
    expect(f.player.gold).toBe(100000);
  });
  it("pays ordinary port construction only after a real owned coast is supplied", () => {
    const f = fixture(true);
    f.building(f.player.id, "factory", 60, 16);
    f.game.restore(f.game.checkpoint());
    const tile = [60, 59, 61, 58, 62, 57, 63]
      .map((x) => f.map.ref(x, 19))
      .find((t) => !f.game.buildingSite(f.player.id, "port", t))!;
    expect(tile).toBeDefined();
    const controller = f.e.economy.coasts;
    controller.goals.set(f.player.id, {
      id: "coast-funded",
      playerId: f.player.id,
      generation: f.game.aiGeneration(f.player.id),
      phase: "fund",
      cursor: 0,
      index: 0,
      shortlist: [],
      members: [],
      tile,
      created: 0,
      deadline: 6000,
      nextThink: 0,
      reason: "fixture",
    });
    const expected = buildingCost("port", "StoneAge", 0).gold!,
      before = f.player.gold;
    controller.step(8);
    controller.step(8);
    expect(
      f.game
        .buildingsAt(tile)
        .some((b) => b.type === "port" && b.remainingTicks > 0),
    ).toBe(true);
    expect(f.player.gold).toBe(before - expected);
    expect(controller.goals.get(f.player.id)?.phase).toBe("fund");
    f.game.tick = 100;
    controller.step(8);
    controller.step(8);
    expect(controller.goals.get(f.player.id)?.phase).toBe("complete");
  });
  it("bombards with real weapon cooldown and rejects a transport as an attacker", () => {
    const f = fixture(true),
      target = f.building(1, "port", 60, 19),
      ship = f.ship(f.player.id, 60, 21);
    expect(
      f.game.applyCommand({
        type: "naval-attack",
        playerId: f.player.id,
        shipIds: [ship.id],
        targetId: target.id,
      }),
    ).toBeNull();
    f.game.step();
    const damaged = f.game.building(target.id)!.health!;
    expect(damaged).toBeLessThan(1000);
    f.game.step();
    expect(f.game.building(target.id)!.health).toBe(damaged);
    f.game.updateShip(ship.id, {
      kind: "transport",
      definitionId: "stoneage-transport",
      attackTargetId: null,
    });
    expect(
      f.game.applyCommand({
        type: "naval-attack",
        playerId: f.player.id,
        shipIds: [ship.id],
        targetId: target.id,
      }),
    ).toMatch(/warships/);
  });
  it("does not fire through a wall and does not bypass weapon target eligibility", () => {
    const f = fixture(true),
      target = f.building(1, "city", 60, 17),
      ship = f.ship(f.player.id, 60, 21);
    const left = f.building(1, "tower", 59, 18),
      right = f.building(1, "tower", 61, 18);
    const wall = {
      id: f.game.allocateId(),
      playerId: 1,
      age: "StoneAge" as const,
      a: left.id,
      b: right.id,
      tiles: [f.map.ref(60, 18)],
      health: 1000,
      maxHealth: 1000,
      remainingTicks: 0,
    };
    const saved = f.e.fortifications.checkpoint();
    saved.barriers.push(wall);
    f.e.fortifications.restore(saved);
    expect(
      f.game.applyCommand({
        type: "naval-attack",
        playerId: f.player.id,
        shipIds: [ship.id],
        targetId: target.id,
      }),
    ).toBeNull();
    f.game.step();
    expect(f.game.building(target.id)!.health).toBe(1000);
    const original = f.e.vessel.bind(f.e);
    vi.spyOn(f.e, "vessel").mockImplementation((s) => ({
      ...original(s),
      attack: { ...original(s).attack!, targets: ["ship"] },
    }));
    expect(
      f.game.applyCommand({
        type: "naval-attack",
        playerId: f.player.id,
        shipIds: [ship.id],
        targetId: target.id,
      }),
    ).toMatch(/cannot attack/);
  });
  it("certifies a coastal firing position and withdraws after escort loss", () => {
    const f = fixture(true),
      target = f.building(1, "port", 70, 19),
      first = f.ship(),
      second = f.ship(f.player.id, 61, 21);
    f.game.restore(f.game.checkpoint());
    for (let n = 0; n < 100; n++) f.e.economy.navalFacts.step(f.game.tick, 32);
    const m: AiFleetMission = {
      id: "bombard-fixture",
      playerId: f.player.id,
      generation: f.game.aiGeneration(f.player.id),
      objective: "bombard-coast",
      sea: f.game.waterPaths.component[f.game.tileOf(first)],
      state: "stage",
      reason: "fixture",
      createdTick: 0,
      deadline: 2400,
      nextAssessment: 0,
      port: undefined,
      anchor: f.map.ref(60, 20),
      members: [first.id, second.id],
      purchases: 0,
      bombard: {
        phase: "position",
        scanned: 0,
        target: target.id,
        candidate: 0,
        start: f.game.tileOf(first),
        since: 0,
      },
    };
    f.e.economy.assets.acquire(
      m.members.map((id) => ({
        asset: `ship:${id}` as const,
        playerId: f.player.id,
        generation: m.generation,
        controller: m.id,
        priority: "operation" as const,
        createdTick: 0,
        expiresTick: 2400,
      })),
    );
    for (let n = 0; n < 100 && m.bombard?.phase === "position"; n++) {
      f.game.tick++;
      f.game.routePlanner.step(f.game.tick);
      expect(
        stepBombardment(f.player, m, f.e, f.e.economy, 2).work,
      ).toBeLessThanOrEqual(2);
    }
    expect(m.bombard?.phase).toBe("sail");
    f.game.removeShip(second.id);
    expect(stepBombardment(f.player, m, f.e, f.e.economy, 2)).toMatchObject({
      terminal: "recover",
    });
    expect(m.bombard).toBeUndefined();
    expect(f.game.building(target.id)!.health).toBe(1000);
  });
});

describe("supported land breach and recovery ownership", () => {
  it("uses a researched siege shot with escorts and withdraws when that support is lost", () => {
    const f = fixture(),
      own = [
        f.add(),
        f.add("stoneage-infantry", 61),
        f.add("stoneage-siege", 60, 11),
      ];
    const tower = f.building(1, "tower", 60, 12);
    f.game.restore(f.game.checkpoint());
    expect(
      f.game.applyCommand({
        type: "create-army",
        playerId: f.player.id,
        squadIds: own.map((s) => s.id),
      }),
    ).toBeNull();
    const army = f.e.armies.armyOf(own[0].id)!,
      planner = f.e.economy.military.armyPlanner;
    const plan = {
      id: "breach-fixture",
      playerId: f.player.id,
      generation: f.game.aiGeneration(f.player.id),
      phase: "breach" as const,
      created: 0,
      since: 0,
      deadline: 3000,
      nextThink: 0,
      cursor: 0,
      rosterIds: own.map((s) => s.id),
      members: own.map((s) => s.id),
      armyId: army.id,
      target: 1,
      targetTile: tower.tile,
      initialTroops: 3000,
      reason: "fixture",
      breach: {
        scan: 81,
        start: f.map.ref(60, 10),
        building: tower.id,
        cursor: 0,
        shooters: [own[2].id],
        tile: f.map.ref(60, 11),
        since: 0,
      },
    };
    planner.objectives.set(f.player.id, plan);
    f.e.economy.assets.acquire(
      own.map((s) => ({
        asset: `squad:${s.id}` as const,
        playerId: f.player.id,
        generation: plan.generation,
        controller: plan.id,
        priority: "operation" as const,
        createdTick: 0,
        expiresTick: 3800,
      })),
    );
    const find = vi.spyOn(f.game.paths, "find");
    planner.step(8);
    expect(f.game.squad(own[2].id)!.structureTarget?.buildingId).toBe(tower.id);
    expect(find).not.toHaveBeenCalled();
    f.game.removeSquad(own[0].id);
    f.game.tick = 40;
    planner.step(8);
    expect(planner.objectives.get(f.player.id)?.phase).toBe("recover");
    expect(f.game.building(tower.id)!.health).toBe(1000);
  });
  it("renews the recovered roster through its original deadline when it rejoins", () => {
    const f = fixture(),
      own = [f.add(), f.add("stoneage-infantry", 61)],
      planner = f.e.economy.military.armyPlanner;
    f.e.supply.inventories[f.player.id] = {};
    const plan = {
      id: "rejoin-fixture",
      playerId: f.player.id,
      generation: f.game.aiGeneration(f.player.id),
      phase: "replenish" as const,
      created: 0,
      since: 0,
      deadline: 3000,
      nextThink: 0,
      cursor: 0,
      rosterIds: own.map((s) => s.id),
      members: own.map((s) => s.id),
      target: 1,
      targetTile: f.map.ref(70, 10),
      initialTroops: 2000,
      reason: "fixture",
    };
    planner.objectives.set(f.player.id, plan);
    f.e.economy.assets.acquire(
      own.map((s) => ({
        asset: `squad:${s.id}` as const,
        playerId: f.player.id,
        generation: plan.generation,
        controller: plan.id,
        priority: "recovery" as const,
        createdTick: 0,
        expiresTick: 100,
      })),
    );
    const gold = f.player.gold;
    planner.step(8);
    expect(planner.objectives.get(f.player.id)).toMatchObject({
      phase: "assemble",
      rejoined: 1,
    });
    f.e.economy.assets.expire(
      101,
      (id) => f.game.aiGeneration(id),
      () => true,
    );
    expect(
      own.every((s) => f.e.economy.assets.owns(`squad:${s.id}`, plan.id)),
    ).toBe(true);
    expect(f.player.gold).toBe(gold);
  });
});
