import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { PRODUCTION_RECIPES } from "../../src/skirmish/content/Production";
import { personalityOf } from "../../src/skirmish/content/AiPersonalities";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { economicCandidates } from "../../src/skirmish/domain/AiEconomicPlanner";
import { militaryDemand } from "../../src/skirmish/domain/AiMilitaryDemand";
import { automaticProduction } from "../../src/skirmish/domain/AutomaticProduction";
import { FIXED } from "../../src/skirmish/Protocol";
import { AiInvasionResponse } from "../../src/skirmish/domain/AiInvasionResponse";
import { tradeCycleQuote } from "../../src/skirmish/domain/TradeQuote";
import { AiProductionDependencies } from "../../src/skirmish/domain/AiProductionDependencies";
import { militaryPosture } from "../../src/skirmish/domain/AiMilitaryPosture";
import { UNITS } from "../../src/skirmish/content/Units";

function fixture() {
  const map=new GameMapImpl(220,100,new Uint8Array(220*100).fill(133),22000);
  const game=new Skirmish(map,{seed:47,aiCount:1,tribes:false,ruleset:"ages-v1",aiEconomy:true,runAi:false});
  let player=game.players[1]; const expansion=game.expansion!, research=TECHNOLOGIES.map(t=>t.id);
  const saved=game.checkpoint();saved.owners.fill(player.id);game.restore(saved);player=game.players[1];
  for(const b of [...game.buildings])game.removeBuilding(b.id);
  for(const s of game.squads)game.updateSquad(s.id,{x:30.5*FIXED,y:50.5*FIXED});
  player.gold=1000000;player.reserves=20000;
  const state=expansion.progression.states[player.id];state.age="Modern";state.completed=research;
  const add=(type:Parameters<typeof game.buildingSite>[1],x:number,y=50,owner=player.id)=>game.addBuilding({
    id:game.allocateId(),playerId:owner,type,tile:map.ref(x,y),age:"Modern",remainingTicks:0,health:10000});
  const snapshot=()=>economicSnapshot({player,tick:game.tick,generation:game.aiGeneration(player.id),age:"Modern",research,
    inventory:expansion.supply.inventories[player.id],buildings:game.buildingFacts().byOwner(player.id),
    squads:game.squadFacts().aliveByOwner(player.id),ships:[],jobs:[],production:{},cap:0,threatTroops:0});
  return {game,map,player,expansion,research,state,add,snapshot};
}

describe("late-game AI development",()=>{
  it("mobilizes a wealthy isolated military nation toward capacity rather than the twelve-squad ceiling",()=>{
    const f=fixture();f.player.gold=20000000;f.player.personalityId="conqueror";
    const snapshot={...f.snapshot(),cap:200,headroom:195,isolated:true};
    const items={...snapshot.liquid.items};
    for(const unit of UNITS)for(const [item,n] of Object.entries(unit.cost.items??{}))items[item]=n*1000;
    snapshot.liquid={...snapshot.liquid,items};
    const demand=militaryDemand(snapshot,personalityOf(f.player),new Set());
    expect(militaryPosture(snapshot,personalityOf(f.player)).target).toBe(190);
    expect(Object.values(demand.units).reduce((sum,n)=>sum+(n??0),0)).toBeGreaterThanOrEqual(185);
    const poor={...snapshot,liquid:{...snapshot.liquid,gold:10000}};
    const poorDemand=militaryDemand(poor,personalityOf(f.player),new Set());
    expect(Object.values(poorDemand.units).reduce((sum,n)=>sum+(n??0),0)).toBeLessThan(30);
  });
  it("keeps recruitment available alongside higher-scoring late development and pays each accepted order",()=>{
    const f=fixture();f.player.gold=20000000;f.player.personalityId="conqueror";
    f.add("barracks",30);f.add("archery",40);f.add("depot",50);f.add("city",60);
    for(const unit of UNITS)for(const [item,n] of Object.entries(unit.cost.items??{}))f.expansion.supply.inventories[f.player.id][item]=n*1000;
    const commands=vi.spyOn(f.game,"applyCommand"),gold=f.player.gold,reserves=f.player.reserves;
    for(let i=0;i<10 && !commands.mock.calls.some(([c])=>c.type==="recruit");i++){f.game.tick+=60;f.expansion.economy.decide(f.player);}
    const accepted=commands.mock.calls.map(([c],i)=>({c,result:commands.mock.results[i]})).filter(row=>row.c.type==="recruit" && row.result.value===null);
    expect(accepted.length).toBeGreaterThan(0);expect(f.player.gold).toBeLessThan(gold);expect(f.player.reserves).toBeLessThan(reserves);
    expect(f.game.recruitment.byOwner(f.player.id).length).toBeGreaterThan(0);
  });
  it("adds city-centered missile stacks and gives anti-air a city guard lease",()=>{
    const f=fixture();f.player.gold=20000000;f.game.options.aiDefenses=true;
    const city=f.add("city",60),sam=f.add("missile-defence",67);
    const squad=f.game.squadFacts().aliveByOwner(f.player.id)[0];f.game.updateSquad(squad.id,{definitionId:"modern-anti-air"});
    f.expansion.supply.inventories[f.player.id].steel=10000;
    let candidate:ReturnType<typeof f.expansion.economy.placements.candidates>[number]|undefined;
    for(let i=0;i<40&&!candidate;i++)candidate=f.expansion.economy.placements.candidates(f.player,f.snapshot()).find(c=>c.type==="missile-defence");
    expect(candidate?.tile).toBe(sam.tile);
    for(let i=0;i<10&&!f.expansion.economy.assets.held(`squad:${squad.id}`);i++){f.game.tick+=60;f.expansion.economy.decide(f.player);}
    expect(f.expansion.economy.assets.owns(`squad:${squad.id}`,`city-air:${f.player.id}`)).toBe(true);
    expect(f.game.squad(squad.id)!.order).toMatchObject({type:"move"});
    const order=f.game.squad(squad.id)!.order;
    if(order.type==="move")expect(f.map.euclideanDistSquared(order.tile,city.tile)).toBeLessThanOrEqual(6**2);
  });
  it("quotes modern vehicle and payload chains from renewable raw inputs",()=>{
    const f=fixture();
    for(const id of Object.keys(f.expansion.supply.inventories[f.player.id]))f.expansion.supply.inventories[f.player.id][id]=0;
    const dependencies=new AiProductionDependencies(f.snapshot(),new Set(["ironOre","carbon","oil","gunpowder","copper","tin","stone","horses"]));
    expect(dependencies.availability("equipment:modern-vehicle",1)).toBe("available");
    expect(dependencies.availability("payload:hydrogen",1)).toBe("available");
  });
  it("expands oil extraction while demand exceeds available oil",()=>{
    const f=fixture(),well=f.add("oil-well",40);
    f.expansion.supply.replaceDeposits([{id:1,tile:well.tile,resource:"oil",owner:f.player.id,yieldPerSecond:3},
      {id:2,tile:f.map.ref(60,50),resource:"oil",owner:f.player.id,yieldPerSecond:3}]);
    f.expansion.supply.inventories[f.player.id].oil=0;
    let found=false;
    for(let i=0;i<100 && !found;i++)found=f.expansion.economy.placements.candidates(f.player,f.snapshot(),
      {equipment:{oil:200},materials:{oil:200},units:{}}).some(c=>c.type==="oil-well" && c.tile===f.map.ref(60,50) && c.objective===12000);
    expect(found).toBe(true);
  });
  it("grows the proven profitable factory stack instead of losing it behind the site cursor",()=>{
    const f=fixture(),factory=f.add("factory",50),market=f.add("factory",100,50,1);
    const template=f.game.squadFacts().aliveByOwner(f.player.id)[0];
    for(let i=0;i<5;i++)f.game.addSquad({...structuredClone(template),id:f.game.allocateId()});
    const quote=tradeCycleQuote({naval:false,stock:100,capacity:40,valuePerGood:10,supplyTicks:0,
      legs:[{marketId:market.id,distance:50,foreign:true,allied:false,travelTicks:500}],returnTicks:500,observedRisk:0});
    f.expansion.economy.tradeQuotes.restore({cursor:0,evidence:[[`${f.player.id}:false`,{
      source:factory.id,market:market.id,quote,tick:f.game.tick,generation:f.game.aiGeneration(f.player.id)}]]});
    f.expansion.economy.placements.restore({types:[[f.player.id,1]],sites:[[`${f.player.id}:factory`,40]],
      lands:[[`${f.player.id}:factory`,{anchor:f.player.base,tiles:f.game.ownedLandNearest(f.player.id,f.player.base,64),cursor:40}]]});
    expect(f.expansion.economy.placements.candidates(f.player,f.snapshot()).some(c=>c.type==="factory" && c.tile===factory.tile)).toBe(true);
  });
  it("uses a small defensive detachment for border harassment and preserves the offensive army",()=>{
    const f=fixture();f.game.options.aiWarPolicy=true;f.add("city",20);f.add("city",40);
    const template=f.game.squadFacts().aliveByOwner(f.player.id)[0];
    for(let i=0;i<12;i++)f.game.addSquad({...structuredClone(template),id:f.game.allocateId()});
    for(const s of f.game.squadFacts().aliveByOwner(1))f.game.removeSquad(s.id);
    const enemy=f.game.addSquad({...structuredClone(template),id:f.game.allocateId(),playerId:1,x:100.5*FIXED,y:50.5*FIXED});
    f.expansion.operations.threatened(f.player.id,1,f.game.tileOf(enemy));
    const response=new AiInvasionResponse(f.expansion,f.expansion.economy),release=vi.fn();
    response.step(f.player,128,release);
    expect(response.active(f.player.id)).toBe(true);expect(response.blocking(f.player.id)).toBe(false);expect(release).not.toHaveBeenCalled();
    expect(response.checkpoint()[0][1].members.length).toBeGreaterThan(2);
    const leases=[...f.expansion.economy.assets.leases.values()].filter(l=>l.controller===`invasion:${f.player.id}`);
    expect(leases.length).toBeLessThanOrEqual(4);
    f.game.updateSquad(enemy.id,{x:20.5*FIXED});
    f.game.removeBuilding(f.game.buildings.find(b=>b.type==="city" && f.map.x(b.tile)===40)!.id);
    f.expansion.operations.threatened(f.player.id,1,f.game.tileOf(f.game.squad(enemy.id)!));
    response.step(f.player,128,release);expect(response.blocking(f.player.id)).toBe(true);expect(release).toHaveBeenCalledOnce();
  });
  it("finds and funds modern air and strategic infrastructure with a full land army",()=>{
    const f=fixture(),found=new Map<string,ReturnType<typeof f.expansion.economy.placements.candidates>[number]>();
    for(let i=0;i<400 && found.size<3;i++)for(const c of f.expansion.economy.placements.candidates(f.player,f.snapshot()))
      if(["airstrip","missile-silo","mirv-launcher"].includes(c.type))found.set(c.type,c);
    expect([...found.keys()].sort()).toEqual(["airstrip","mirv-launcher","missile-silo"]);
    const candidates=economicCandidates(f.snapshot(),f.state,personalityOf(f.player),
      {equipment:{},materials:{},units:{}},1,[...found.values()]);
    expect(candidates.flatMap(c=>c.command.type==="build" ? [c.command.buildingType] : [])).toEqual(expect.arrayContaining([...found.keys()]));
  });

  it("carries strategic payload and oil requirements into automatic production",()=>{
    const f=fixture();f.add("missile-silo",30);f.add("mirv-launcher",40);const arms=f.add("arms-factory",50);
    Object.assign(f.expansion.supply.inventories[f.player.id],{steel:10000,gunpowder:10000,oil:10000});
    const demand=militaryDemand(f.snapshot(),personalityOf(f.player),new Set(["iron","coal","oil","sulfur","saltpetre"]));
    expect(demand.equipment["payload:hydrogen"]).toBe(2);
    expect(demand.equipment["payload:mirv"]).toBe(2);
    expect(demand.equipment.oil).toBeGreaterThanOrEqual(60);
    // Salvos use spare industrial capacity after the army's kit buffers are full.
    for(const [id,n] of Object.entries(demand.equipment))if(id.startsWith("equipment:"))
      f.expansion.supply.inventories[f.player.id][id]=n;
    const jobs=automaticProduction({buildings:[arms],research:f.research,inventory:f.expansion.supply.inventories[f.player.id],
      incoming:{},recipes:PRODUCTION_RECIPES,plans:new Map(),busy:new Set(),renewable:new Set(),squadCount:0,ai:true,aiDemand:demand});
    expect([...jobs.values()].some(id=>id==="make-hydrogen" || id==="make-mirv")).toBe(true);
  });

  it("uses aviation and strategic weapons under the active economic planner only against war targets",()=>{
    const f=fixture(),airfield=f.add("airstrip",30),silo=f.add("missile-silo",40),target=f.add("city",100,50,1);
    for(const s of [...f.game.squads])if(s.playerId===1)f.game.removeSquad(s.id);
    f.expansion.aircraft.push({id:f.game.allocateId(),playerId:f.player.id,definitionId:"bomber",airfieldId:airfield.id,
      x:30.5*FIXED,y:50.5*FIXED,health:1000,target:null,state:"ready",reloadTick:0,fuelTicks:1200});
    f.expansion.supply.inventories[f.player.id]["payload:hydrogen"]=2;
    const commands=vi.spyOn(f.game,"applyCommand"),think=f.expansion as unknown as {thinkProgression():void};
    f.game.tick=(f.player.id%20)*3;
    think.thinkProgression();
    expect(commands.mock.calls.some(([c])=>c.type==="recruit-aircraft")).toBe(true);
    expect(commands.mock.calls.some(([c])=>c.type==="launch" || c.type==="sortie")).toBe(false);
    f.expansion.diplomacy.state.wars=[{a:f.player.id,b:1}];commands.mockClear();think.thinkProgression();
    expect(commands.mock.calls.some(([c])=>c.type==="sortie")).toBe(true);
    expect(commands.mock.calls.some(([c])=>c.type==="launch" && c.launcherId===silo.id && c.buildingId===target.id)).toBe(true);
  });
  it("uses a smaller payload when the hydrogen blast would hit a non-war faction",()=>{
    const f=fixture();f.add("missile-silo",40);f.add("city",100,50,1);
    const own=f.game.squadFacts().aliveByOwner(f.player.id)[0];
    f.game.updateSquad(own.id,{x:110.5*FIXED,y:50.5*FIXED});
    for(const s of f.game.squadFacts().aliveByOwner(1))f.game.removeSquad(s.id);
    Object.assign(f.expansion.supply.inventories[f.player.id],{"payload:hydrogen":2,"payload:icbm":1});
    f.expansion.diplomacy.state.wars=[{a:f.player.id,b:1}];
    const commands=vi.spyOn(f.game,"applyCommand");f.game.tick=(f.player.id%20)*3;
    (f.expansion as unknown as {thinkProgression():void}).thinkProgression();
    expect(commands.mock.calls.some(([c])=>c.type==="launch" && c.payload==="icbm")).toBe(true);
    expect(commands.mock.calls.some(([c])=>c.type==="launch" && c.payload==="hydrogen")).toBe(false);
  });
});
