import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AI_PERSONALITIES } from "../../src/skirmish/content/AiPersonalities";
import { ADVANCES, TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNITS } from "../../src/skirmish/content/Units";
import { economicCandidates } from "../../src/skirmish/domain/AiEconomicPlanner";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";
import { advanceRejection, progressionRaceStarted, startingProgression } from "../../src/skirmish/domain/Progression";
import { AiProductionDependencies } from "../../src/skirmish/domain/AiProductionDependencies";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(age: Age) {
  const terrain = new Uint8Array(64 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(64, 64, terrain, terrain.length), {
    seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
  });
  const player = game.players[1], state = game.expansion!.progression.states[player.id];
  player.gold = 1_000_000;
  state.age = age;
  state.completed = TECHNOLOGIES.filter(t => AGES.indexOf(t.age) <= AGES.indexOf(age)).map(t => t.id);
  for (const b of game.buildings.filter(b => b.playerId === player.id))
    game.updateBuilding(b.id, { remainingTicks: 0, age });
  game.addBuilding({ id: game.allocateId(), playerId: player.id, type: "barracks", tile: player.base, remainingTicks: 0, age });
  const next = UNITS.find(u => u.age === AGES[AGES.indexOf(age) + 1] && u.line === "infantry")!;
  const snapshot = economicSnapshot({
    player, tick: 0, generation: 0, age, research: state.completed,
    inventory: { ...next.cost.items }, buildings: game.buildings, squads: game.squads,
    ships: [], jobs: [], production: {}, cap: game.squads.filter(s => s.playerId === player.id).length,
    threatTroops: 0,
  });
  snapshot.readyTroops = 1000;
  const opportunity = { resources: [], usableCoast: false, seaThreat: 0, goods: 0, protectedItems: {} };
  const choices = () => economicCandidates(snapshot, state, AI_PERSONALITIES[0], { units: {}, equipment: {}, materials: {} }, 1, [], opportunity);
  return { game, player, state, snapshot, choices };
}

describe("AI progression scoring", () => {
  it("chooses prerequisite research over optional growth once a safe standing force exists", () => {
    const {state,snapshot}=fixture("BronzeAge");
    const unfinished=TECHNOLOGIES.filter(t=>t.age==="BronzeAge" && t.slot>=4).map(t=>t.id);
    state.completed=state.completed.filter(id=>!unfinished.includes(id));
    snapshot.research=state.completed;
    snapshot.readyTroops=6000;
    snapshot.liquid.gold=1000;
    const candidates=economicCandidates(snapshot,state,AI_PERSONALITIES[0],
      {units:{},equipment:{},materials:{}},1,
      [{type:"factory",tile:0,objective:5500,reason:"capacity:factory"}]);
    expect(candidates[0].kind).toBe("research");
    expect(candidates[0].priority).toBe("committed");
    expect(candidates[0].cost.gold).toBeGreaterThan(snapshot.liquid.gold!);
  });
  it("saves for a viable age-up instead of repeatedly buying profitable infrastructure", () => {
    const {game,player,state,snapshot}=fixture("BronzeAge");
    game.options.aiEconomy=true;
    game.owners.fill(player.id);
    const template=game.squads[0];
    for (const squad of [...game.squads])game.removeSquad(squad.id);
    for(let i=0;i<4;i++)game.addSquad({...template,id:game.allocateId(),playerId:player.id,
      definitionId:"bronzeage-infantry",troops:1000,embarkedOn:null,refit:null});
    game.expansion!.supply.inventories[player.id]={...snapshot.liquid.items};
    player.gold=1000;
    const capacity=vi.spyOn(game,"squadCapacity").mockReturnValue(4);
    const placements=vi.spyOn(game.expansion!.economy.placements,"candidates").mockReturnValue([
      {type:"factory",tile:player.base,objective:5500,reason:"capacity:factory"}]);
    const refitting=vi.spyOn(game.expansion!.economy.military,"decide").mockReturnValue(false);
    try {
      game.expansion!.economy.decide(player);
      expect(player.gold).toBe(1000);
      expect(game.expansion!.economy.ledger.protected(player.id).gold).toBe(1000);
      const saved=game.expansion!.economy.checkpoint();
      game.expansion!.economy.restore(saved);
      while(player.gold<ADVANCES[1].gold) {
        player.gold=Math.min(ADVANCES[1].gold,player.gold+1000);
        game.tick+=60;
        game.expansion!.economy.decide(player);
        if(state.advancement)break;
      }
      expect(state.advancement?.target).toBe("ClassicalAge");
      expect(player.gold).toBe(0);
      expect(refitting).not.toHaveBeenCalled();
    } finally {capacity.mockRestore();placements.mockRestore();refitting.mockRestore();}
  });
  it("prioritizes affordable emergency troops over an age-up", () => {
    const {state,snapshot}=fixture("BronzeAge");
    snapshot.headroom=10;
    snapshot.threatTroops=600;
    const candidates=economicCandidates(snapshot,state,AI_PERSONALITIES[0],
      {units:{frontline:10},equipment:{},materials:{}},1,[]);
    expect(candidates[0].priority).toBe("emergency");
    expect(candidates[0].kind).toBe("recruit");
  });
  it.each(AGES.slice(0, -1))("keeps a viable funded %s age transition selectable", age => {
    const { choices } = fixture(age);
    const advance = choices().find(c => c.kind === "advance");
    expect(advance).toBeDefined();
    expect(advance!.score).toBeGreaterThan(0);
  });
  it.each(AGES.slice(0, -1))("keeps useful unfinished %s research selectable", age => {
    const { state, snapshot, choices } = fixture(age);
    const technology = TECHNOLOGIES.find(t => t.age === age && t.tree === "economic" && t.slot === 4)!;
    state.completed = state.completed.filter(id => id !== technology.id);
    snapshot.research = state.completed;
    const research = choices().find(c => c.command.type === "research" && c.command.technologyId === technology.id);
    expect(research).toBeDefined();
    expect(research!.score).toBeGreaterThan(0);
  });
  it("lets a wealthy balanced AI pay for and complete the Bronze-to-Classical transition", () => {
    const { game, player, state, snapshot } = fixture("BronzeAge");
    player.personalityId = "balanced";
    game.options.aiEconomy = true;
    game.owners.fill(player.id);
    const template = game.squads[0];
    for (const squad of [...game.squads]) game.removeSquad(squad.id);
    game.addSquad({ ...template, id: game.allocateId(), playerId: player.id, definitionId: "bronzeage-infantry", troops: 1000, embarkedOn: null, refit: null });
    game.expansion!.supply.inventories[player.id] = { ...snapshot.liquid.items };
    const capacity = vi.spyOn(game, "squadCapacity").mockReturnValue(1);
    const placements = vi.spyOn(game.expansion!.economy.placements, "candidates").mockReturnValue([]);
    const refitting = vi.spyOn(game.expansion!.economy.military, "decide").mockReturnValue(false);
    try {
      game.expansion!.economy.decide(player);
      expect(state.advancement?.target).toBe("ClassicalAge");
      expect(player.gold).toBe(1_000_000 - ADVANCES[1].gold);
      for (let i = 0; i < ADVANCES[1].ticks; i++) game.expansion!.progression.step(game.players);
      expect(state.age).toBe("ClassicalAge");
    } finally {
      capacity.mockRestore(); placements.mockRestore(); refitting.mockRestore();
    }
  });
  it("keeps a legal age-up selectable despite material shortages or danger, without bypassing payment or trees", () => {
    const { game, player, state, snapshot, choices } = fixture("BronzeAge");
    player.gold = ADVANCES[1].gold - 1;
    expect(advanceRejection(state, player.gold)).toBe("Needs 1 more gold");
    expect(game.expansion!.progression.advance(player)).toBe("Needs 1 more gold");
    expect(state.advancement).toBeNull();
    snapshot.liquid.items = {};
    expect(choices().some(c => c.kind === "advance")).toBe(true);
    snapshot.liquid.items = { ...UNITS.find(u => u.id === "classicalage-infantry")!.cost.items };
    snapshot.threatTroops = snapshot.readyTroops;
    expect(choices().some(c => c.kind === "advance")).toBe(true);
    snapshot.threatTroops = 0;
    state.completed = state.completed.filter(id => !id.startsWith("bronzeage-"));
    expect(choices().some(c => c.kind === "advance")).toBe(false);
  });
  it("ages up despite an inconclusive bounded equipment query", () => {
    const {game,player,state}=fixture("BronzeAge");
    game.options.aiEconomy=true;
    game.expansion!.supply.inventories[player.id]={};
    const query=vi.spyOn(AiProductionDependencies.prototype,"availability").mockImplementation(function (this: AiProductionDependencies) {
      this.deferred=true; return "deferred";
    });
    try {
      game.expansion!.economy.decide(player);
      expect(query).toHaveBeenCalled();
      expect(state.advancement?.target).toBe("ClassicalAge");
    } finally { query.mockRestore(); }
  });
  it("starts the race at two completed trees, retains it across advancement and restore, and ignores one tree", () => {
    const state=startingProgression();
    const finish=(tree:string)=>state.completed.push(...TECHNOLOGIES.filter(t=>t.age==="StoneAge" && t.tree===tree).map(t=>t.id));
    finish("naval");
    expect(progressionRaceStarted({1:state},"StoneAge")).toBe(false);
    finish("economic");
    expect(progressionRaceStarted({1:state},"StoneAge")).toBe(true);
    state.age="BronzeAge";
    expect(progressionRaceStarted(structuredClone({1:state}),"StoneAge")).toBe(true);
    expect(progressionRaceStarted({1:state},"BronzeAge")).toBe(false);
  });
  it("races toward two trees even with a small army and useful economic expansion available", () => {
    const {snapshot}=fixture("StoneAge"),state=startingProgression();
    snapshot.research=state.completed;snapshot.readyTroops=1000;snapshot.liquid.gold=200;
    const choices=economicCandidates(snapshot,state,AI_PERSONALITIES[0],{units:{},equipment:{},materials:{}},1,
      [{type:"factory",tile:0,objective:9000,reason:"capacity:factory"}],
      {resources:[],usableCoast:false,seaThreat:0,goods:0,protectedItems:{},progressionRace:true});
    expect(choices[0].kind).toBe("research");
    expect(choices[0].reason).toContain("progression-race:");
    expect(choices[0].priority).toBe("committed");
  });
});
