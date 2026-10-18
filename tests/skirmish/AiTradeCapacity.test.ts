import { describe, expect, it } from "vitest";
import { economicCandidates } from "../../src/skirmish/domain/AiEconomicPlanner";
import { personalityOf } from "../../src/skirmish/content/AiPersonalities";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { FACTORY_CARGO_REPLENISH_SECONDS, tradeSourceActorCap } from "../../src/skirmish/content/Economy";
import { tradeCargoCapacity, tradeCargoEffects } from "../../src/skirmish/domain/TradeCargo";
import { aiTradeCapacity } from "../../src/skirmish/domain/AiTradeCapacity";
import type { TradeActor } from "../../src/skirmish/domain/Definitions";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";

function fixture(coastal = true, partner = true, pond = false) {
  const width = 160,
    height = 96,
    data = new Uint8Array(width * height).fill(133);
  if (coastal)
    for (let y = 0; y < height; y++)
      for (let x = 72; x < 88; x++) data[y * width + x] = 0;
  if(pond) for(let y=8;y<13;y++)for(let x=10;x<15;x++)data[y*width+x]=0;
  const game = new Skirmish(new GameMapImpl(width, height, data, data.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    ruleset: "ages-v1",
    aiEconomy: true,
    runAi: false,
  });
  const saved = game.checkpoint();
  for (let tile = 0; tile < data.length; tile++)
    saved.owners[tile] = data[tile] ? (tile % width < 80 ? 2 : 1) : 0;
  saved.players[0].base = game.map.ref(132, 48);
  saved.players[1].base = game.map.ref(24, 48);
  game.restore(saved);
  const player = game.players[1],
    expansion = game.expansion!;
  for (const building of [...game.buildings]) game.removeBuilding(building.id);
  const research = TECHNOLOGIES.filter((t) =>
    ["StoneAge", "BronzeAge"].includes(t.age),
  ).map((t) => t.id);
  expansion.progression.states[player.id].age = "BronzeAge";
  expansion.progression.states[player.id].completed = research;
  player.gold = 200000;
  player.reserves = 10000;
  const add = (
    type: "city" | "port" | "factory",
    x: number,
    y: number,
    owner = player.id,
    remainingTicks = 0,
  ) =>
    game.addBuilding({
      id: game.allocateId(),
      playerId: owner,
      type,
      tile: game.map.ref(x, y),
      age: "BronzeAge",
      remainingTicks,
    });
  add("city", 24, 48);
  add("city", 132, 48, 1);
  if (coastal) {
    for (const y of [12, 24, 36]) add("port", 70, y);
    if (partner) for (const y of [12, 24, 36, 48]) add("port", 88, y, 1);
  }
  const snapshot = () =>
    economicSnapshot({
      player: game.players[1],
      tick: game.tick,
      generation: game.aiGeneration(player.id),
      age: "BronzeAge",
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
  const quote = () =>
    aiTradeCapacity(
      expansion,
      game.players[1],
      snapshot(),
      expansion.economy.placements.coasts(player.id),
    );
  return { game, player, expansion, add, snapshot, quote };
}

describe("AI trade infrastructure targets", () => {
  it("funds and operates first factories from a normal 36-troop Stone opening while progressing", () => {
    const data = new Uint8Array(128 * 96).fill(133),
      game = new Skirmish(new GameMapImpl(128, 96, data, data.length), {
        seed: 47,
        aiCount: 1,
        tribes: false,
        runAi: true,
        ruleset: "ages-v1",
        startingAge: "StoneAge",
        diplomacyRules: "raids-v1",
        armyTravel: "corridors-v1",
        ...DEFAULT_AI_POLICIES,
      });
    game.players[0].ai = true;
    for (const p of game.players)
      expect(
        game.squads
          .filter((s) => s.playerId === p.id)
          .reduce((n, s) => n + s.troops, 0),
      ).toBe(36);
    const apply = game.applyCommand.bind(game),
      paid: { player: number; tick: number; gold: number }[] = [];
    game.applyCommand = (command) => {
      const before = game.player(command.playerId)?.gold ?? 0,
        result = apply(command);
      if (
        !result &&
        command.type === "build" &&
        command.buildingType === "factory"
      )
        paid.push({
          player: command.playerId,
          tick: game.tick,
          gold: before - game.player(command.playerId)!.gold,
        });
      return result;
    };
    for (let tick = 0; tick < 2400 && game.winner === null; tick++) game.step();
    for (const p of game.players) {
      expect(
        paid.some(
          (row) => row.player === p.id && row.tick < 1440 && row.gold === 1000,
        ),
      ).toBe(true);
      expect(
        game.buildingFacts().completed(p.id, "factory").length,
      ).toBeGreaterThan(0);
      expect(
        game.expansion!.trade.actors.some((a) => a.playerId === p.id && !a.naval),
      ).toBe(true);
      expect(
        AGES.indexOf(game.expansion!.progression.states[p.id].age),
      ).toBeGreaterThanOrEqual(1);
    }
  }, 30000);
  it.each(["factory", "port"] as const)(
    "bootstraps the first productive %s before progression, but counts paid sources before requesting more",
    (type) => {
      const f = fixture();
      for (const b of [...f.game.buildings])
        if (b.playerId === f.player.id && b.type === type)
          f.game.removeBuilding(b.id);
      const snapshot = f.snapshot();
      snapshot.readyTroops = 6000;
      const candidates = Array.from({ length: 100 }, () =>
        f.expansion.economy.placements.candidates(f.player, snapshot),
      ).flat();
      const first = candidates.find((c) => c.type === type);
      expect(first?.bottleneck).toBe("bootstrap");
      const choices = economicCandidates(
        snapshot,
        f.expansion.progression.states[f.player.id],
        personalityOf(f.player),
        { units: {}, equipment: {}, materials: {} },
        1,
        [first!],
      );
      expect(choices[0].kind).toBe("construct");
      expect(choices[0].bottleneck).toBe("bootstrap");
      const gold = f.player.gold;
      expect(f.game.applyCommand(choices[0].command)).toBeNull();
      expect(f.player.gold).toBe(gold - choices[0].cost.gold!);
      expect(
        f.game
          .buildingFacts()
          .byOwner(f.player.id)
          .some((b) => b.type === type && b.remainingTicks > 0),
      ).toBe(true);
      const funded = f.snapshot();
      funded.readyTroops = 6000;
      const next = Array.from({ length: 100 }, () =>
        f.expansion.economy.placements.candidates(f.player, funded),
      )
        .flat()
        .filter((c) => c.type === type);
      expect(next.every((c) => c.bottleneck !== "bootstrap")).toBe(true);
    },
  );
  it("does not let an exploratory pond port consume the first productive port bootstrap", () => {
    const f = fixture(true, true, true);
    for (const b of [...f.game.buildings])
      if (b.playerId === f.player.id && b.type === "port")
        f.game.removeBuilding(b.id);
    f.add("port", 8, 8);
    expect(f.quote().hasProductivePort).toBe(false);
    const snapshot = f.snapshot();
    snapshot.readyTroops = 6000;
    expect(
      Array.from({ length: 100 }, () =>
        f.expansion.economy.placements.candidates(f.player, snapshot),
      )
        .flat()
        .some((c) => c.type === "port" && c.bottleneck === "bootstrap"),
    ).toBe(true);
  });
  it.each(["factory", "port"] as const)(
    "does not preempt progression for a paused %s trade mode",
    (type) => {
      const f = fixture();
      for (const b of [...f.game.buildings])
        if (b.playerId === f.player.id && b.type === type)
          f.game.removeBuilding(b.id);
      f.expansion.trade.setPaused(f.player.id, type === "port", true);
      const snapshot = f.snapshot();
      snapshot.readyTroops = 6000;
      const quotes = Array.from({ length: 100 }, () =>
        f.expansion.economy.placements.candidates(f.player, snapshot),
      )
        .flat()
        .filter((c) => c.type === type);
      expect(quotes.every((c) => c.bottleneck !== "bootstrap")).toBe(true);
    },
  );
  it("keeps an exploratory port without any lawful receiving market as ordinary growth", () => {
    const f = fixture(true, false);
    for (const b of [...f.game.buildings])
      if (b.playerId === f.player.id && b.type === "port")
        f.game.removeBuilding(b.id);
    expect(f.quote().usefulSeas.size).toBe(0);
    const snapshot = f.snapshot();
    snapshot.readyTroops = 6000;
    const ports = Array.from({ length: 100 }, () =>
      f.expansion.economy.placements.candidates(f.player, snapshot),
    )
      .flat()
      .filter((c) => c.type === "port");
    expect(ports.length).toBeGreaterThan(0);
    expect(ports.every((c) => c.bottleneck !== "bootstrap")).toBe(true);
  });

  it("requests more than three distinct ports from useful receiving/fleet throughput before any completed voyage", () => {
    const f = fixture(),
      quote = f.quote();
    expect(f.expansion.trade.cycleQuotes.size).toBe(0);
    expect(quote.portTarget).toBeGreaterThan(3);
    expect(quote.portTarget).toBeLessThanOrEqual(40);
    expect(quote.seaDemandPerSecond).toBeGreaterThan(
      3 * quote.portGoodsPerSecond,
    );
    const snapshot = f.snapshot();
    snapshot.readyTroops = 6000;
    const existing = new Set(
      snapshot.buildings.filter((b) => b.type === "port").map((b) => b.tile),
    );
    const candidates = Array.from({ length: 100 }, () =>
      f.expansion.economy.placements.candidates(f.player, snapshot),
    ).flat();
    expect(
      candidates.some(
        (c) =>
          c.type === "port" &&
          !existing.has(c.tile) &&
          c.reason === "trade-capacity:port",
      ),
    ).toBe(true);
  });
  it("keeps three ports when a single receiving market cannot use more production", () => {
    const f = fixture(true, false);
    f.add("port", 88, 48, 1);
    expect(f.quote().portTarget).toBe(3);
  });
  it("counts paid incoming port production toward the target", () => {
    const f = fixture(),
      target = f.quote().portTarget;
    for (let n = 3; n < target; n++)
      f.add("port", 70, 12 + (n % 20) * 4, f.player.id, 100);
    expect(f.quote().portTarget).toBe(target);
    const snapshot = f.snapshot();
    snapshot.readyTroops = 6000;
    expect(
      Array.from({ length: 100 }, () =>
        f.expansion.economy.placements.candidates(f.player, snapshot),
      )
        .flat()
        .some((c) => c.type === "port"),
    ).toBe(false);
  });
  it("does not grow an existing port network without a permitted foreign receiving market", () => {
    const f = fixture(true, false);
    expect(f.quote().portTarget).toBe(3);
    for (const y of [12, 24, 36, 48]) f.add("port", 88, y, 1);
    expect(f.quote().portTarget).toBeGreaterThan(3);
    f.expansion.trade.setBlocked(f.player.id, 1, true, true);
    expect(f.quote().portTarget).toBe(3);
  });
  it("uses safely reclaimable excess land couriers as future sea headroom", () => {
    const f = fixture();
    for (let n = 0; n < 128; n++)
      f.expansion.trade.actors.push({
        id: 10000 + n,
        playerId: f.player.id,
        naval: false,
        state: "loading",
        cargo: 0,
        originTile: f.player.base,
      } as TradeActor);
    expect(f.quote().portTarget).toBeGreaterThan(3);
    for (const actor of f.expansion.trade.actors) {
      actor.state = "outbound";
      actor.cargo = 25;
    }
    expect(f.quote().portTarget).toBe(3);
  });
  it("does not replace the current naval quota with a forced actor-count goal", () => {
    const f = fixture();
    for (let n = 0; n < 104; n++)
      f.expansion.trade.actors.push({
        id: 10000 + n,
        playerId: f.player.id,
        naval: true,
        state: "loading",
        cargo: 0,
        originTile: f.game.map.ref(70, 12),
      } as TradeActor);
    expect(f.quote().portTarget).toBe(3);
  });
  it("develops factory land trade when usable sea access is absent", () => {
    const f = fixture(false),
      quote = f.quote();
    expect(quote.portTarget).toBe(0);
    expect(quote.factoryTarget).toBeGreaterThan(0);
    expect(quote.landDemandPerSecond).toBeGreaterThan(0);
  });
  it("keeps the next investment bounded by its liquid/income and payback horizon", () => {
    const f = fixture(),
      snapshot = f.snapshot();
    snapshot.liquid.gold = 0;
    snapshot.goldIncome = 0;
    expect(
      aiTradeCapacity(
        f.expansion,
        f.player,
        snapshot,
        f.expansion.economy.placements.coasts(f.player.id),
      ).portTarget,
    ).toBe(3);
  });
  it("invalidates derived market geometry when restoring the same game to a different market layout", () => {
    const f = fixture(true, false),
      saved = f.game.checkpoint();
    for (const y of [12, 24, 36, 48]) f.add("port", 88, y, 1);
    expect(f.quote().portTarget).toBeGreaterThan(3);
    f.game.restore(saved);
    expect(f.quote().portTarget).toBe(3);
    expect(f.quote().usefulSeas.size).toBe(0);
  });
});


it("sizes factories for both ten-second refill and source courier limits",()=>{
  const f=fixture(false),snapshot=f.snapshot(),quote=f.quote();
  const rate=tradeCargoCapacity(tradeCargoEffects(snapshot.research),false)/FACTORY_CARGO_REPLENISH_SECONDS;
  expect(quote.factoryTarget * rate).toBeGreaterThanOrEqual(quote.landDemandPerSecond);
  expect(quote.factoryTarget * tradeSourceActorCap(snapshot.age)).toBeGreaterThanOrEqual(128);
  expect(quote.factoryTarget).toBeGreaterThan(1);
});

it("adds factory sites when long voyages exhaust courier slots despite sufficient raw goods generation",()=>{
  const f=fixture(false);
  for(let n=0;n<4;n++){
    const b=f.add("factory",10+n*5,15);
    for(let j=0;j<6;j++){
      const id=10000+n*6+j;
      f.expansion.trade.actors.push({id,playerId:f.player.id,naval:false,state:"outbound",cargo:20,originTile:b.tile} as TradeActor);
      f.expansion.trade.cycleQuotes.set(id,{quantity:20, delivered:20, returned:0, guaranteedGold:400, supplyTicks:0, handlingTicks:0, travelTicks:2400, cycleTicks:2400, goldPer1000Ticks:167, observedRisk:0, riskAdjustedGoldPer1000Ticks:167});
    }
  }
  const quote=f.quote(),rate=tradeCargoCapacity(tradeCargoEffects(f.snapshot().research),false)/FACTORY_CARGO_REPLENISH_SECONDS;
  expect(4*rate).toBeGreaterThan(quote.landDemandPerSecond);
  expect(quote.factoryTarget).toBeGreaterThan(4);
});
