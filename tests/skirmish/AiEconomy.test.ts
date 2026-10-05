import { TICKS_PER_SECOND } from "../../src/skirmish/Protocol";
import { productionTicks } from "../../src/skirmish/domain/Supply";
import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { personalityOf } from "../../src/skirmish/content/AiPersonalities";
import { PRODUCTION_RECIPES } from "../../src/skirmish/content/Production";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { militaryDemand } from "../../src/skirmish/domain/AiMilitaryDemand";
import { AiProductionDependencies } from "../../src/skirmish/domain/AiProductionDependencies";
import { automaticProduction } from "../../src/skirmish/domain/AutomaticProduction";
import { economicCandidates } from "../../src/skirmish/domain/AiEconomicPlanner";
import { tradeCycleQuote } from "../../src/skirmish/domain/TradeQuote";

function fixture() {
  const map = new GameMapImpl(
    96,
    64,
    new Uint8Array(96 * 64).fill(133),
    96 * 64,
  );
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 1,
    tribes: false,
    ruleset: "ages-v1",
    aiEconomy: true,
    runAi: true,
  });
  const player = game.players[1],
    expansion = game.expansion!;
  return { game, player, expansion };
}
describe("coordinated AI economy", () => {
  it("expands markets rather than producers when profitable couriers return unsold cargo", () => {
    const {game,player,expansion}=fixture();
    const territory=game.checkpoint();territory.owners.fill(player.id);game.restore(territory);
    const research=TECHNOLOGIES.filter(t=>["StoneAge","BronzeAge"].includes(t.age)).map(t=>t.id);
    expansion.progression.states[player.id].age="BronzeAge";
    expansion.progression.states[player.id].completed=research;
    const tiles=game.ownedLandNearest(player.id,player.base,64);
    for(const b of [...game.buildings])game.removeBuilding(b.id);
    const city=game.addBuilding({id:game.allocateId(),playerId:player.id,type:"city",tile:tiles[0],age:"BronzeAge",remainingTicks:0});
    const factories=[tiles[20],tiles[40]].map(tile=>game.addBuilding({id:game.allocateId(),playerId:player.id,type:"factory",tile,age:"BronzeAge",remainingTicks:0}));
    for(const b of factories)expansion.supply.goods.set(b.id,100);
    const snapshot=economicSnapshot({player,tick:0,generation:0,age:"BronzeAge",research,inventory:{},
      buildings:game.buildingFacts().byOwner(player.id),squads:game.squads,ships:[],jobs:[],production:{},cap:20,threatTroops:0});
    snapshot.readyTroops=6000;
    const quote=tradeCycleQuote({naval:false,stock:30,capacity:30,valuePerGood:10,supplyTicks:0,
      legs:[{marketId:city.id,quantity:10,distance:10,foreign:false,allied:false,travelTicks:60}],returnTicks:60,observedRisk:0});
    const best=vi.spyOn(expansion.economy.tradeQuotes,"best").mockImplementation((_id,naval)=>naval?undefined:
      {source:factories[0].id,market:city.id,quote,tick:0,generation:game.aiGeneration(player.id)});
    try {
      const candidates=Array.from({length:300},()=>expansion.economy.placements.candidates(player,snapshot,{equipment:{},materials:{},units:{}})).flat();
      expect(candidates.some(c=>c.type==="factory"&&c.objective>0)).toBe(false);
      expect(candidates.some(c=>c.type==="city"&&c.objective>=3500)).toBe(true);
      // A fully sold trip is still no reason to grow if existing sources have
      // stock waiting: it may simply be the best trader at a congested market.
      quote.returned=0;quote.delivered=30;
      expect(Array.from({length:300},()=>expansion.economy.placements.candidates(player,snapshot)).flat()
        .some(c=>c.type==="factory"&&c.objective>0)).toBe(false);
      for(const b of factories)expansion.supply.goods.set(b.id,0);
      expect(Array.from({length:300},()=>expansion.economy.placements.candidates(player,snapshot)).flat()
        .some(c=>c.type==="factory"&&c.objective>=3000)).toBe(true);
    } finally {best.mockRestore();}
  });
  it("finds a workshop beyond a saturated capital and resumes the placement page after restore", () => {
    const {game,player,expansion}=fixture();
    const territory=game.checkpoint();
    territory.owners.fill(player.id);
    game.restore(territory);
    const research=TECHNOLOGIES.filter(t=>["StoneAge","BronzeAge"].includes(t.age)).map(t=>t.id);
    expansion.progression.states[player.id].age="BronzeAge";
    expansion.progression.states[player.id].completed=research;
    const inner=game.ownedLandNearest(player.id,player.base,64);
    for(const tile of inner)game.addBuilding({id:game.allocateId(),playerId:player.id,type:"barracks",tile,age:"BronzeAge",remainingTicks:0});
    const snapshot=economicSnapshot({player,tick:0,generation:0,age:"BronzeAge",research,inventory:{bronze:100},
      buildings:game.buildingFacts().byOwner(player.id),squads:[],ships:[],jobs:[],production:{},cap:0,threatTroops:0});
    const demand={equipment:{"equipment:bronzeage":10},materials:{},units:{}};
    let found:ReturnType<typeof expansion.economy.placements.candidates>[number]|undefined;
    for(let i=0;i<300&&!found;i++) {
      found=expansion.economy.placements.candidates(player,snapshot,demand).find(c=>c.type==="blacksmith");
      if(i===50){const saved=expansion.economy.placements.checkpoint();expansion.economy.placements.restore(saved);}
    }
    expect(found).toBeDefined();
    expect(inner).not.toContain(found!.tile);
    expect(game.buildingSite(player.id,"blacksmith",found!.tile,"BronzeAge")).toBeNull();
  });
  it("builds an equipment chain from owned unmined deposits instead of staying on Stone Age troops", () => {
    const {game,player,expansion}=fixture();
    game.options.runAi=false;
    const state=expansion.progression.states[player.id];
    state.age="BronzeAge";
    state.completed=TECHNOLOGIES.filter(t=>["StoneAge","BronzeAge"].includes(t.age)).map(t=>t.id);
    player.gold=200000;
    player.reserves=20000;
    for(const b of [...game.buildings].filter(b=>b.playerId===player.id))game.removeBuilding(b.id);
    const tiles=game.ownedLandNearest(player.id,player.base,64);
    const barracks=game.addBuilding({id:game.allocateId(),playerId:player.id,type:"barracks",tile:tiles[0],remainingTicks:0,age:"BronzeAge"});
    const copper=tiles.find(t=>game.map.euclideanDistSquared(t,barracks.tile)>=16)!;
    const tin=tiles.find(t=>game.map.euclideanDistSquared(t,barracks.tile)>=16&&game.map.euclideanDistSquared(t,copper)>=16)!;
    expansion.supply.replaceDeposits([
      {id:1,tile:copper,resource:"copper",owner:player.id,yieldPerSecond:3},
      {id:2,tile:tin,resource:"tin",owner:player.id,yieldPerSecond:3},
    ]);
    for(const id of Object.keys(expansion.supply.inventories[player.id]))expansion.supply.inventories[player.id][id]=0;
    let madeKit=false;
    const advance=()=>{
      if(game.tick%60===0)expansion.economy.decide(player);
      game.step();
      madeKit=(expansion.supply.inventories[player.id]["equipment:bronzeage"]??0)>0;
    };
    for(let i=0;i<6000&&!madeKit;i++)advance();
    for(const tile of [copper,tin])expect(game.buildings.some(b=>b.playerId===player.id&&b.type==="mine"&&b.tile===tile)).toBe(true);
    expect(game.buildings.some(b=>b.playerId===player.id&&b.type==="factory"&&!b.remainingTicks)).toBe(true);
    expect(game.buildings.some(b=>b.playerId===player.id&&b.type==="blacksmith"&&!b.remainingTicks)).toBe(true);
    // Placement and construction have their own deadline. A newly completed
    // refinery still owes two paid batches before a 12-bronze kit can be crafted.
    const refining=PRODUCTION_RECIPES.find(r=>r.id==="refine-bronze")!;
    const equipment=PRODUCTION_RECIPES.find(r=>r.id==="make-bronzeage-equipment")!;
    const batches=Math.ceil(equipment.inputs.bronze/refining.outputs.bronze);
    const productionAllowance=(batches*Math.ceil(productionTicks(refining,state.completed)/TICKS_PER_SECOND)+Math.ceil(productionTicks(equipment,state.completed)/TICKS_PER_SECOND)+1)*TICKS_PER_SECOND;
    for(let i=0;i<productionAllowance&&!madeKit;i++)advance();
    expect(madeKit).toBe(true);
    expect(game.building(barracks.id)).toBeDefined();
  });
  for (const type of ["blacksmith", "armory", "arms-factory", "depot", "siege-workshop"] as const)
    it(`can fund a missing ${type} with no recruitment headroom`, () => {
      const { player } = fixture(), research = TECHNOLOGIES.map(t => t.id),
        age = type === "blacksmith" ? "BronzeAge" : type === "armory" ? "EarlyModern" : "Modern";
      const recipe = PRODUCTION_RECIPES.find(r => r.building === type)!;
      const snapshot = economicSnapshot({ player, tick: 0, generation: 0, age, research,
        inventory: { ...recipe.inputs }, buildings: [], squads: [], ships: [], jobs: [], production: {}, cap: 0, threatTroops: 0 });
      const candidates = economicCandidates(snapshot, { age, completed: research, cultureId: "default", research: {}, advancement: null }, personalityOf(player),
        { equipment: Object.fromEntries(Object.keys(recipe.outputs).map(id => [id, 100])), materials: {}, units: {} }, 1,
        [{ type, tile: player.base, objective: 12000, reason: `production-prerequisite:${type}` }]);
      expect(snapshot.headroom).toBe(0);
      expect(candidates.some(c => c.command.type === "build" && c.command.buildingType === type)).toBe(true);
    });
  it("offers a first coastal port without any foreign port", () => {
    const data = new Uint8Array(96 * 64).fill(133);
    for (let y = 0; y < 64; y++) for (let x = 80; x < 96; x++) data[y * 96 + x] = 0;
    const game = new Skirmish(new GameMapImpl(96, 64, data, data.length), {
      seed: 47, aiCount: 1, tribes: false, ruleset: "ages-v1", aiEconomy: true, runAi: false });
    const player = game.players[1], expansion = game.expansion!, research = TECHNOLOGIES.map(t => t.id);
    expansion.supply.replaceDeposits([]);
    for (let y = 0; y < 64; y++) {
      for (const x of [78,79]) {
        const tile = game.map.ref(x, y);
        (game as unknown as {changeOwner(tile:number,owner:number):void}).changeOwner(tile,player.id);
      }
    }
    const snapshot = economicSnapshot({ player, tick: 0, generation: 0, age: "Modern", research,
      inventory: {}, buildings: [], squads: [], ships: [], jobs: [], production: {}, cap: 20, threatTroops: 0 });
    const candidates = Array.from({ length: 14 }, () => expansion.economy.placements.candidates(player, snapshot)).flat();
    expect(game.buildings.some(b => b.type === "port")).toBe(false);
    expect(candidates.some(c => c.type === "port" && c.objective > 0)).toBe(true);
  });
  it("expires ownership before controllers even on ticks with no economic decision", () => {
    const { game, player, expansion } = fixture(),
      economy = expansion.economy;
    const squad = game.squads.find((s) => s.playerId === player.id)!;
    economy.assets.acquire([
      {
        asset: `squad:${squad.id}`,
        playerId: player.id,
        generation: game.aiGeneration(player.id),
        controller: "expired-test",
        priority: "operation",
        createdTick: 0,
        expiresTick: 1,
      },
    ]);
    economy.ledger.tryReserve(
      {
        id: "expired-test",
        playerId: player.id,
        generation: game.aiGeneration(player.id),
        claimant: "expired-test",
        priority: "growth",
        amounts: { gold: 1 },
        createdTick: 0,
        progressTick: 0,
        expiresTick: 1,
      },
      { gold: player.gold },
    );
    game.tick = 1;
    economy.step();
    expect(economy.assets.held(`squad:${squad.id}`)).toBe(false);
    expect(economy.ledger.reservations.has("expired-test")).toBe(false);
    expect(economy.diagnostics.decisions).toBe(0);
  });
  it("funds an attainable workshop dependency before its refined equipment input exists", () => {
    const { player, expansion } = fixture();
    const research = TECHNOLOGIES.filter((t) =>
      ["StoneAge", "BronzeAge"].includes(t.age),
    ).map((t) => t.id);
    const snapshot = economicSnapshot({
      player,
      tick: 0,
      generation: 0,
      age: "BronzeAge",
      research,
      inventory: { copper: 80, tin: 20 },
      buildings: [
        {
          id: 900,
          playerId: player.id,
          type: "barracks",
          age: "BronzeAge",
          remainingTicks: 0,
          tile: player.base,
        },
      ],
      squads: [],
      ships: [],
      jobs: [],
      production: {},
      cap: 20,
      threatTroops: 0,
    });
    const demand = militaryDemand(snapshot, personalityOf(player), new Set());
    expect(demand.equipment["equipment:bronzeage"]).toBeGreaterThan(0);
    expect(demand.materials.bronze).toBeGreaterThan(0);
    const candidates = expansion.economy.placements.candidates(
      player,
      snapshot,
      demand,
    );
    // Rotation keeps exact tile work bounded; production-chain utility itself
    // must not require an already-built blacksmith or a finished bronze batch.
    expect(
      new AiProductionDependencies(snapshot, new Set()).available(
        "equipment:bronzeage",
        1,
      ),
    ).toBe(true);
    expect(candidates.length).toBeLessThanOrEqual(8);
  });
  it("merges shared refining demand before subtracting paid input batches", () => {
    const { player } = fixture(),
      research = TECHNOLOGIES.map((t) => t.id);
    const snapshot = economicSnapshot({
      player,
      tick: 0,
      generation: 0,
      age: "Modern",
      research,
      inventory: {},
      buildings: [],
      squads: [],
      ships: [],
      jobs: [],
      production: {},
      cap: 20,
      threatTroops: 0,
    });
    snapshot.incoming.bronze = 10;
    const recipe = PRODUCTION_RECIPES.find(
      (r) => r.outputs["equipment:bronzeage"],
    )!;
    const materials = new AiProductionDependencies(
      snapshot,
      new Set(["copper", "tin"]),
    ).materials({ "equipment:bronzeage": 2 });
    expect(materials.bronze).toBe(recipe.inputs.bronze * 2);
    expect(materials.copper).toBe(
      8 * Math.ceil((recipe.inputs.bronze * 2 - 10) / 10),
    );
  });
  it("pays refits once, respects shared savings, and releases only unpaid work at takeover", () => {
    const { game, player, expansion } = fixture();
    const research = expansion.progression.states[player.id];
    research.age = "BronzeAge";
    research.completed = TECHNOLOGIES.filter((t) =>
      ["StoneAge", "BronzeAge"].includes(t.age),
    ).map((t) => t.id);
    for (const squad of game.squads.filter((s) => s.playerId === player.id)) {
      game.updateSquad(squad.id, { kind: "infantry" });
      game.updateSquad(squad.id, { definitionId: "stoneage-infantry" });
      game.updateSquad(squad.id, { x: (game.map.x(player.base) + 0.5) * 256 });
      game.updateSquad(squad.id, { y: (game.map.y(player.base) + 0.5) * 256 });
    }
    player.gold = 100000;
    expansion.supply.inventories[player.id]["equipment:bronzeage"] = 20;
    const now = player.gold;
    expansion.economy.ledger.tryReserve(
      {
        id: "research",
        claimant: "research",
        playerId: player.id,
        generation: game.aiGeneration(player.id),
        priority: "committed",
        amounts: { gold: now },
        createdTick: 0,
        progressTick: 0,
        expiresTick: 500,
      },
      { gold: now },
    );
    expect(expansion.economy.military.decide(player)).toBe(false);
    expansion.economy.ledger.release("research");
    expect(expansion.economy.military.decide(player)).toBe(true);
    const paid = game.squads.find((s) => s.playerId === player.id && s.refit)!;
    expect(paid).toBeDefined();
    expect(player.gold).toBeLessThan(now);
    expect(expansion.economy.assets.held(`squad:${paid.id}`)).toBe(true);
    game.setAiController(player.id, false);
    expect(paid.refit).not.toBeNull();
    expect(expansion.economy.assets.leases.size).toBe(0);
    expect(expansion.economy.ledger.reservations.size).toBe(0);
  });
  it("bounds purchases to one faction per global slot and releases unpaid savings on takeover", () => {
    const { game, player, expansion } = fixture();
    player.gold = 1;
    const commands = vi.spyOn(game, "applyCommand");
    expansion.economy.decide(player);
    expect(commands).not.toHaveBeenCalled();
    expect(expansion.economy.ledger.reservations.size).toBe(1);
    game.setAiController(player.id, false);
    expect(expansion.economy.ledger.reservations.size).toBe(0);
    expect(expansion.economy.production(player.id)).toEqual({});
    expect(player.gold).toBe(1);
  });
  it("continues identically after restoring candidate cursors, savings and production demand", () => {
    const { game, player } = fixture();
    player.gold = 500;
    for (let i = 0; i < 100; i++) game.step();
    const saved = game.checkpoint();
    const clone = fixture().game;
    clone.restore(saved);
    for (let i = 0; i < 120; i++) {
      game.step();
      clone.step();
    }
    expect(clone.checkpoint()).toEqual(game.checkpoint());
  });
  it("quotes placement without granting funds or bypassing authoritative purchases", () => {
    const { game, player } = fixture();
    player.gold = 0;
    const tile = game
      .ownedLandNearest(player.id, player.base, 256)
      .find((t) => game.buildingSite(player.id, "city", t) === null)!;
    expect(tile).toBeDefined();
    expect(game.buildingSite(player.id, "city", tile)).toBeNull();
    expect(
      game.applyCommand({
        type: "build",
        playerId: player.id,
        buildingType: "city",
        tile,
      }),
    ).not.toBeNull();
    expect(player.gold).toBe(0);
  });
  it("uses only compatible completed producers and never requests equipment for unbuildable Modern units", () => {
    const { game, player, expansion } = fixture();
    const snapshot = economicSnapshot({
      player,
      tick: 0,
      generation: 0,
      age: "Modern",
      research: TECHNOLOGIES.map((t) => t.id),
      inventory: { stone: 1000 },
      buildings: [
        {
          id: 900,
          playerId: player.id,
          type: "barracks",
          age: "StoneAge",
          remainingTicks: 0,
          tile: player.base,
        },
      ],
      squads: [],
      ships: [],
      jobs: [],
      production: {},
      cap: 20,
      threatTroops: 0,
    });
    const demand = militaryDemand(snapshot, personalityOf(player), new Set());
    expect(
      Object.keys(demand.equipment).every((id) => id.includes("stoneage")),
    ).toBe(true);
    expect(expansion.economy.enabled(player)).toBe(true);
    expect(game.options.aiEconomy).toBe(true);
  });
  it("protects reserved production inputs and subtracts paid incoming output exactly once", () => {
    const recipe = PRODUCTION_RECIPES.find(
      (r) => r.outputs["equipment:bronzeage"],
    );
    expect(recipe).toBeDefined();
    const context = {
      buildings: [
        {
          id: 1,
          playerId: 1,
          type: recipe!.building,
          age: "BronzeAge" as const,
          remainingTicks: 0,
          tile: 0,
        },
      ],
      research: TECHNOLOGIES.map((t) => t.id),
      inventory: { ...recipe!.inputs },
      incoming: {},
      recipes: PRODUCTION_RECIPES,
      plans: new Map(),
      busy: new Set<number>(),
      renewable: new Set<string>(),
      squadCount: 0,
      ai: true,
      aiDemand: {
        equipment: { "equipment:bronzeage": 1 },
        materials: {},
        units: {},
      },
    };
    expect(
      automaticProduction({
        ...context,
        protectedInputs: { ...recipe!.inputs },
      }).size,
    ).toBe(0);
    expect(
      automaticProduction({
        ...context,
        incoming: { "equipment:bronzeage": 1 },
      }).size,
    ).toBe(0);
  });
});
