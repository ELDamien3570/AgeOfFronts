import { TRADE_RULES } from "../../src/skirmish/content/Economy";
import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { secondsToTicks, type BuildingType } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { personalityOf } from "../../src/skirmish/content/AiPersonalities";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { infrastructureCapacity } from "../../src/skirmish/domain/AiInfrastructureCapacity";
import type { AiProductionDemand } from "../../src/skirmish/domain/AiMilitaryDemand";
import { militaryDemand } from "../../src/skirmish/domain/AiMilitaryDemand";
import type { TradeActor } from "../../src/skirmish/domain/Definitions";
import { productionReserveTargets } from "../../src/skirmish/domain/ProductionReservePolicy";

function fixture(coastal = false) {
  const data = new Uint8Array(96 * 64).fill(133);
  if (coastal)
    for (let y = 0; y < 64; y++)
      for (let x = 80; x < 96; x++) data[y * 96 + x] = 0;
  const map = new GameMapImpl(96, 64, data, 96 * 64);
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 1,
    tribes: false,
    ruleset: "ages-v1",
    aiEconomy: true,
    runAi: false,
  });
  const saved = game.checkpoint();
  saved.owners.fill(game.players[1].id);
  game.restore(saved);
  const player = game.players[1],
    expansion = game.expansion!;
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  const research = TECHNOLOGIES.filter((t) =>
    ["StoneAge", "BronzeAge", "ClassicalAge"].includes(t.age),
  ).map((t) => t.id);
  expansion.progression.states[player.id].age = "ClassicalAge";
  expansion.progression.states[player.id].completed = research;
  player.gold = 10000;
  player.reserves = 10000;
  const add = (type: BuildingType, tile: number, remainingTicks = 0) =>
    game.addBuilding({
      id: game.allocateId(),
      playerId: player.id,
      type,
      tile,
      age: "ClassicalAge",
      remainingTicks,
    });
  const snapshot = () =>
    economicSnapshot({
      player,
      tick: game.tick,
      generation: game.aiGeneration(player.id),
      age: "ClassicalAge",
      research,
      inventory: expansion.supply.inventories[player.id],
      buildings: game.buildingFacts().byOwner(player.id),
      squads: [],
      ships: [],
      jobs: [],
      production: {},
      cap: 40,
      threatTroops: 0,
    });
  const demand: AiProductionDemand = {
    equipment: {},
    materials: { iron: 1200 },
    units: {},
  };
  return { game, player, expansion, add, snapshot, demand };
}

describe("AI infrastructure capacity", () => {
  it("sizes equipment lines and upstream refining for the allocator's shared ready reserve", () => {
    const f = fixture();
    f.add("factory", 100);
    f.add("blacksmith", 200);
    const snapshot = f.snapshot();
    snapshot.liquid.items = { ironOre: 5000, iron: 0 };
    const demand = militaryDemand(
      snapshot,
      personalityOf(f.player),
      new Set(["ironOre", "horses"]),
    );
    expect(demand.equipment["equipment:classicalage"]).toBeGreaterThanOrEqual(
      productionReserveTargets(snapshot.buildings, 0).troop,
    );
    const capacity = infrastructureCapacity(snapshot, demand);
    expect(capacity.workshops.get("blacksmith")).toBeGreaterThan(1);
    expect(capacity.workshops.get("factory")).toBeGreaterThan(1);
    expect(capacity.processingReady("factory")).toBe(true);
    expect(capacity.processingReady("blacksmith")).toBe(false);
    snapshot.liquid.items = {...snapshot.liquid.items, iron: 100};
    expect(
      infrastructureCapacity(snapshot, demand).processingReady("blacksmith"),
    ).toBe(true);
  });

  it("does not multiply mines to fund a reserve beyond its paid downstream throughput", () => {
    const f = fixture();
    f.add("factory", 100);
    f.add("blacksmith", 200);
    const mine = f.add("mine", 300);
    const deposits = [
      {
        id: 1,
        tile: mine.tile,
        resource: "ironOre" as const,
        owner: f.player.id,
        yieldPerSecond: 3,
      },
      {
        id: 2,
        tile: 400,
        resource: "ironOre" as const,
        owner: f.player.id,
        yieldPerSecond: 3,
      },
    ];
    const snapshot = f.snapshot();
    snapshot.liquid.items = {};
    const demand = {
      units: {},
      equipment: { "equipment:classicalage": 1000 },
      materials: { iron: 12000, ironOre: 12000 },
    };
    expect(
      infrastructureCapacity(snapshot, demand).extractionNeeded(
        deposits[1],
        deposits,
      ),
    ).toBe(false);
    // Growing funded processing capacity eventually justifies more extraction.
    for (let n = 0; n < 9; n++) {
      f.add("factory", 500 + n * 10);
      f.add("blacksmith", 700 + n * 10);
    }
    const expanded = f.snapshot();
    expanded.liquid.items = {};
    expect(
      infrastructureCapacity(expanded, demand).extractionNeeded(
        deposits[1],
        deposits,
      ),
    ).toBe(true);
    const bootstrap = {
      ...snapshot,
      buildings: snapshot.buildings.filter((b) => b.type !== "mine"),
    };
    expect(
      infrastructureCapacity(bootstrap, demand).extractionNeeded(
        deposits[1],
        deposits,
      ),
    ).toBe(true);
  });

  it("retains independent raw material demand alongside equipment without doubling expanded inputs", () => {
    const f = fixture();
    f.add("factory", 100);
    f.add("blacksmith", 200);
    const mine = f.add("mine", 300);
    const deposits = [
      {
        id: 1,
        tile: mine.tile,
        resource: "ironOre" as const,
        owner: f.player.id,
        yieldPerSecond: 3,
      },
      {
        id: 2,
        tile: 400,
        resource: "ironOre" as const,
        owner: f.player.id,
        yieldPerSecond: 3,
      },
    ];
    const snapshot = f.snapshot();
    snapshot.liquid.items = {};
    const regular = {
      units: {},
      equipment: { "equipment:classicalage": 1000 },
      materials: { iron: 12000, ironOre: 12000 },
    };
    expect(
      infrastructureCapacity(snapshot, regular).extractionNeeded(
        deposits[1],
        deposits,
      ),
    ).toBe(false);
    const direct = {
      ...regular,
      materials: { ...regular.materials, ironOre: 22000 },
    };
    expect(
      infrastructureCapacity(snapshot, direct).extractionNeeded(
        deposits[1],
        deposits,
      ),
    ).toBe(true);
  });
  it("sizes a third Classical refinery from work and counts paid construction", () => {
    const f = fixture();
    f.add("factory", 100);
    f.add("factory", 200);
    const snapshot = f.snapshot();
    expect(
      infrastructureCapacity(snapshot, f.demand).workshops.get("factory"),
    ).toBeGreaterThan(2);
    const candidates = Array.from({ length: 100 }, () =>
      f.expansion.economy.placements.candidates(f.player, snapshot, f.demand),
    ).flat();
    expect(
      candidates.some(
        (c) =>
          c.type === "factory" &&
          c.reason === "production-capacity:factory" &&
          c.tile !== 100 &&
          c.tile !== 200,
      ),
    ).toBe(true);
    const desired = infrastructureCapacity(snapshot, f.demand).workshops.get(
      "factory",
    )!;
    for (let n = 2; n < desired; n++)
      f.add("factory", 300 + n * 20, secondsToTicks(30));
    expect(
      Array.from({ length: 100 }, () =>
        f.expansion.economy.placements.candidates(
          f.player,
          f.snapshot(),
          f.demand,
        ),
      )
        .flat()
        .some(
          (c) =>
            c.type === "factory" && c.reason === "production-capacity:factory",
        ),
    ).toBe(false);
  });

  it("suppresses mine spam with stock and paid extraction while expanding a real shortage", () => {
    const f = fixture(),
      mine = f.add("mine", 100, secondsToTicks(30));
    const deposits = [
      {
        id: 1,
        tile: mine.tile,
        resource: "ironOre" as const,
        owner: f.player.id,
        yieldPerSecond: 3,
      },
      {
        id: 2,
        tile: 200,
        resource: "ironOre" as const,
        owner: f.player.id,
        yieldPerSecond: 3,
      },
    ];
    f.expansion.supply.replaceDeposits(deposits);
    const demand = { ...f.demand, materials: { ironOre: 100 } };
    expect(
      infrastructureCapacity(f.snapshot(), demand).extractionNeeded(
        deposits[1],
        deposits,
      ),
    ).toBe(false);
    expect(
      Array.from({ length: 100 }, () =>
        f.expansion.economy.placements.candidates(
          f.player,
          f.snapshot(),
          demand,
        ),
      )
        .flat()
        .some((c) => c.type === "mine"),
    ).toBe(false);
    demand.materials.ironOre = 5000;
    expect(
      infrastructureCapacity(f.snapshot(), demand).extractionNeeded(
        deposits[1],
        deposits,
      ),
    ).toBe(true);
    expect(
      Array.from({ length: 100 }, () =>
        f.expansion.economy.placements.candidates(
          f.player,
          f.snapshot(),
          demand,
        ),
      )
        .flat()
        .some((c) => c.type === "mine" && c.tile === deposits[1].tile),
    ).toBe(true);
    f.expansion.supply.inventories[f.player.id].ironOre = 6000;
    expect(
      infrastructureCapacity(f.snapshot(), demand).extractionNeeded(
        deposits[1],
        deposits,
      ),
    ).toBe(false);
  });

  it("exhausts later land pages before stacking, including across checkpoint restore", () => {
    const f = fixture();
    f.add("factory", 100);
    f.add("factory", 200);
    const pages = [Array.from({ length: 64 }, (_, n) => n + 300), [900]];
    vi.spyOn(f.game, "ownedLandNearest").mockImplementation(
      (_id, _anchor, _limit, after) =>
        after === undefined ? pages[0] : after === 363 ? pages[1] : [],
    );
    const checked = new Set<number>();
    vi.spyOn(f.game, "buildingSite").mockImplementation((_id, type, tile) => {
      if (type !== "factory") return "Blocked";
      checked.add(tile);
      return tile === 100 ? null : "Occupied";
    });
    let stack = false;
    for (let i = 0; i < 300 && !stack; i++) {
      const candidates = f.expansion.economy.placements.candidates(
        f.player,
        f.snapshot(),
        f.demand,
      );
      stack = candidates.some((c) => c.type === "factory" && c.tile === 100);
      if (i === 20)
        f.expansion.economy.placements.restore(
          f.expansion.economy.placements.checkpoint(),
        );
      if (stack) expect(checked.has(900)).toBe(true);
    }
    expect(stack).toBe(true);
    expect(checked.has(900)).toBe(true);
  });

  it("keeps an available distinct site ahead of stacks even when its candidate is not selected", () => {
    const f = fixture();
    f.add("factory", 100);
    f.add("factory", 200);
    vi.spyOn(f.expansion.economy.recovery, "canBuild").mockReturnValue(true);
    vi.spyOn(f.game, "ownedLandNearest").mockImplementation(
      (_id, _anchor, _limit, after) => (after === undefined ? [300] : []),
    );
    vi.spyOn(f.game, "buildingSite").mockImplementation((_id, type, tile) =>
      type === "factory" && [100, 300].includes(tile) ? null : "Blocked",
    );
    const candidates = Array.from({ length: 300 }, () =>
      f.expansion.economy.placements.candidates(
        f.player,
        f.snapshot(),
        f.demand,
      ),
    ).flat();
    expect(candidates.some((c) => c.type === "factory" && c.tile === 300)).toBe(
      true,
    );
    expect(candidates.some((c) => c.type === "factory" && c.tile === 100)).toBe(
      false,
    );
  });
  it("keeps pagination moving while territory and research change", () => {
    const f = fixture();
    f.add("factory", 100);
    f.add("factory", 200);
    vi.spyOn(f.expansion.economy.recovery, "canBuild").mockReturnValue(true);
    vi.spyOn(f.game, "ownedLandNearest").mockImplementation(
      (_id, _anchor, _limit, after) =>
        after === undefined
          ? Array.from({ length: 64 }, (_, n) => n + 300)
          : after === 363
            ? [900]
            : [],
    );
    vi.spyOn(f.game, "buildingSite").mockImplementation((_id, type, tile) =>
      type === "factory" && [100, 900].includes(tile) ? null : "Blocked",
    );
    let found = false;
    for (let n = 0; n < 200 && !found; n++) {
      f.expansion.economy.placements.changed(1000 + n, f.player.id, 0);
      found = f.expansion.economy.placements
        .candidates(f.player, f.snapshot(), f.demand)
        .some((c) => c.type === "factory" && c.tile === 900);
    }
    expect(found).toBe(true);
  });

  it("offers a third recruitment site from its actual backlog before the late wealth gate", () => {
    const f = fixture(),
      first = f.add("barracks", 100);
    f.add("barracks", 200);
    const snapshot = f.snapshot();
    snapshot.liquid.items = { "equipment:classicalage": 100 };
    snapshot.recruitment = [
      {
        id: 1,
        playerId: f.player.id,
        buildingId: first.id,
        category: "land",
        kind: "infantry",
        cost: {},
        totalTicks: secondsToTicks(100),
        remainingTicks: secondsToTicks(100),
      },
    ];
    const candidates = Array.from({ length: 100 }, () =>
      f.expansion.economy.placements.candidates(f.player, snapshot, f.demand),
    ).flat();
    expect(
      candidates.some(
        (c) =>
          c.type === "barracks" &&
          c.reason === "production-capacity:barracks" &&
          ![100, 200].includes(c.tile),
      ),
    ).toBe(true);
  });

  it("opens a second distinct port with a real market and respects the actual naval actor quota", () => {
    const f = fixture(true),
      source = f.add("port", f.game.map.ref(78, 20));
    f.game.addBuilding({
      id: f.game.allocateId(),
      playerId: 1,
      type: "port",
      tile: f.game.map.ref(78, 40),
      age: "ClassicalAge",
      remainingTicks: 0,
    });
    const snapshot = f.snapshot();
    snapshot.readyTroops = 6000;
    const candidates = Array.from({ length: 100 }, () =>
      f.expansion.economy.placements.candidates(f.player, snapshot),
    ).flat();
    expect(
      candidates.some(
        (c) =>
          c.type === "port" &&
          c.tile !== source.tile &&
          c.reason === "trade-capacity:port",
      ),
    ).toBe(true);
    for (let n = 0; n < TRADE_RULES.actorCap - TRADE_RULES.reservedLandActors; n++)
      f.expansion.trade.actors.push({
        id: 1000 + n,
        playerId: f.player.id,
        naval: true,
      } as TradeActor);
    expect(
      Array.from({ length: 100 }, () =>
        f.expansion.economy.placements.candidates(f.player, snapshot),
      )
        .flat()
        .some((c) => c.type === "port"),
    ).toBe(false);
  });
  it("continues past unsafe open land without treating it as permission to stack", () => {
    const f = fixture();
    f.add("factory", 100);
    f.add("factory", 200);
    vi.spyOn(f.game, "ownedLandNearest").mockImplementation(
      (_id, _anchor, _limit, after) => (after === undefined ? [300, 900] : []),
    );
    vi.spyOn(f.game, "buildingSite").mockImplementation((_id, type, tile) =>
      type === "factory" && [100, 300, 900].includes(tile) ? null : "Blocked",
    );
    vi.spyOn(f.expansion.economy.recovery, "canBuild").mockImplementation(
      (_id, _type, tile) => tile !== 300,
    );
    const candidates = Array.from({ length: 100 }, () =>
      f.expansion.economy.placements.candidates(
        f.player,
        f.snapshot(),
        f.demand,
      ),
    ).flat();
    expect(candidates.some((c) => c.type === "factory" && c.tile === 900)).toBe(
      true,
    );
    expect(candidates.some((c) => c.type === "factory" && c.tile === 100)).toBe(
      false,
    );
  });
  it("does not stack when a previously cached open site becomes unsafe", () => {
    const f = fixture();
    f.add("factory", 100);
    f.add("factory", 200);
    let safe = true;
    vi.spyOn(f.game, "ownedLandNearest").mockImplementation(
      (_id, _anchor, _limit, after) => (after === undefined ? [300] : []),
    );
    vi.spyOn(f.game, "buildingSite").mockImplementation((_id, type, tile) =>
      type === "factory" && [100, 300].includes(tile) ? null : "Blocked",
    );
    vi.spyOn(f.expansion.economy.recovery, "canBuild").mockImplementation(
      (_id, _type, tile) => tile !== 300 || safe,
    );
    const first = Array.from({ length: 50 }, () =>
      f.expansion.economy.placements.candidates(
        f.player,
        f.snapshot(),
        f.demand,
      ),
    ).flat();
    expect(first.some((c) => c.type === "factory" && c.tile === 300)).toBe(
      true,
    );
    safe = false;
    const later = Array.from({ length: 100 }, () =>
      f.expansion.economy.placements.candidates(
        f.player,
        f.snapshot(),
        f.demand,
      ),
    ).flat();
    expect(later.some((c) => c.type === "factory")).toBe(false);
  });
});
