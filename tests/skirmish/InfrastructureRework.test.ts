import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {GameMapImpl} from "../../src/core/game/GameMap";
import {Skirmish} from "../../src/skirmish/Simulation";
import {AGES} from "../../src/skirmish/domain/Definitions";
import {TECHNOLOGIES,TECHNOLOGY,STARTING_TECHNOLOGIES,canonicalTechnologyId,packageTechnology} from "../../src/skirmish/content/Technology";
import {buildingTechnology,buildingIntegrity,AUTOMATIC_TIER_BUILDINGS} from "../../src/skirmish/content/Buildings";
import {BUILDING_RULES} from "../../src/skirmish/Rules";
import {startingProgression} from "../../src/skirmish/domain/Progression";
import {PRODUCTION_RECIPES} from "../../src/skirmish/content/Production";
import {VESSELS} from "../../src/skirmish/content/Units";
import {landTraderTier,logisticsTier,cargoHandlingPercent,breedingPerSecond} from "../../src/skirmish/domain/ResearchEffects";
import {aircraftArtworkId,ARTWORK_CATALOG} from "../../src/skirmish/client/ArtworkCatalog";
import {EmpireViewModel} from "../../src/skirmish/client/EmpireViewModel";
import actors from "../../src/skirmish/content/RussianTroopActors.json";
const tech=(age: typeof AGES[number],slug:string)=>TECHNOLOGY.get(packageTechnology(age,slug))!;
function fixture(){const terrain=new Uint8Array(64*64).fill(133);return new Skirmish(new GameMapImpl(64,64,terrain,terrain.length),{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1"});}
describe("requested infrastructure rework",()=>{
 it("starts with cities, while workshop/mining and trade need research",()=>{
   const state=startingProgression();expect(STARTING_TECHNOLOGIES).toContain(tech("StoneAge","cities").id);
   expect(state.completed).toContain(buildingTechnology("city","StoneAge"));
   expect(state.completed).not.toContain(tech("StoneAge","factories-mines").id);
   expect(tech("StoneAge","cities")).toMatchObject({gold:0,ticks:0});
   expect(tech("StoneAge","factories-mines").gold).toBeGreaterThan(0);
 });
 it("matches the saved planner and has the requested economics/warfare graph in every age",()=>{
   const plan=JSON.parse(readFileSync("skirmish/plans/technology-plan.json","utf8"));
   const civ=plan.civilizations.find((c:any)=>c.id==="russians-rus-eight-age-rework");
   for(const t of TECHNOLOGIES){const saved=civ.technologies.find((s:any)=>s.id===t.id);expect(t.prerequisites).toEqual(saved.prerequisites);expect(t.name).toBe(saved.name);expect(t.name).not.toMatch(/[âÃÂ�]/);}
   for(const age of AGES){
     const city=tech(age,"cities"),roads=tech(age,"roads"),metal=tech(age,"factories-mines"),fort=tech(age,"fortifications");
     expect(roads.prerequisites).toEqual([city.id]);expect(metal.prerequisites).toEqual([city.id]);
     expect(fort.tree).toBe("economic");expect(fort.prerequisites).toEqual([roads.id,metal.id]);
     expect(tech(age,"siege").prerequisites).toEqual([tech(age,"ranged").id,tech(age,"mobile").id]);
     expect(TECHNOLOGIES.filter(t=>t.age===age&&t.tree==="warfare").some(t=>t.prerequisites.includes(fort.id))).toBe(false);
     expect(canonicalTechnologyId(packageTechnology(age,"land-traders"))).toBe(roads.id);
   }
 });
 it("splits warship recruitment from the port and makes nuclear submarines the final naval gate",()=>{
   expect(VESSELS.find(v=>v.age==="StoneAge"&&v.kind==="warship")!.technologyId).toBe(tech("StoneAge","warships").id);
   expect(VESSELS.find(v=>v.age==="StoneAge"&&v.kind==="trade")!.technologyId).toBe(tech("StoneAge","port-sea-trade").id);
   expect(tech("StoneAge","coastal-navigation").prerequisites).toEqual([tech("StoneAge","port-sea-trade").id,tech("StoneAge","warships").id]);
   const sub=tech("Modern","submarines");for(const n of TECHNOLOGIES.filter(t=>t.age==="Modern"&&t.tree==="naval"&&t.id!==sub.id))expect(sub.prerequisites).toContain(n.id);
 });
 it("grants combined road/trader effects without granting refining from city research",()=>{
   const roads=[tech("Modern","roads").id,tech("StoneAge","roads").id];
   expect(logisticsTier(roads)).toBe(7);expect(landTraderTier(roads)).toBe(7);expect(breedingPerSecond(roads)).toBe(6);expect(cargoHandlingPercent(roads)).toBe(125);
   for(const id of ["refine-bronze","refine-iron","refine-steel"]){const recipe=PRODUCTION_RECIPES.find(r=>r.id===id)!;expect(recipe.technologyId).toContain("factories-mines");}

 });
 it("promotes armories in place, preserving damage, jobs, priorities and construction",()=>{
   const game=fixture(),e=game.expansion!,state=e.progression.states[1],p=game.players[0];
   state.age="EarlyModern";state.completed=TECHNOLOGIES.filter(t=>AGES.indexOf(t.age)<6).map(t=>t.id);
   const max=buildingIntegrity("armory","Napoleonic"),tile=p.base;
   const a=game.addBuilding({id:game.allocateId(),type:"armory",playerId:p.id,tile,age:"Napoleonic",remainingTicks:0,maxHealth:max,health:Math.floor(max/2)});
   const b=game.addBuilding({id:game.allocateId(),type:"armory",playerId:p.id,tile,age:"Napoleonic",remainingTicks:100,maxHealth:max,health:max});
   const recipe=PRODUCTION_RECIPES.find(r=>r.building==="armory")!;
   e.supply.jobs[a.id]={recipeId:recipe.id,owner:p.id,totalTicks:200,remainingTicks:100};
   e.supply.priorities[p.id]={armory:[recipe.id]};
   const gold=p.gold;state.completed.push(tech("EarlyModern","barracks-equipment").id);e.beforeStep();
   const upgraded=game.buildingFacts().byId(a.id)!;expect(upgraded.type).toBe("arms-factory");expect(upgraded.tile).toBe(tile);expect(upgraded.age).toBe("EarlyModern");
   expect(upgraded.health!/upgraded.maxHealth!).toBeCloseTo(Math.floor(max/2)/max,3);
   expect(game.buildingFacts().byId(b.id)!.type).toBe("arms-factory");expect(game.buildingFacts().byId(b.id)!.remainingTicks).toBe(100);
   expect(e.supply.jobs[a.id]!.recipeId).toBe(recipe.id);expect(e.supply.priorities[p.id]["arms-factory"]).toEqual([recipe.id]);expect(p.gold).toBe(gold);
   const restored=fixture();restored.restore(game.checkpoint());expect(restored.buildingFacts().byId(a.id)!.type).toBe("arms-factory");
   const vm=new EmpireViewModel(game.snapshot(),{selected:new Set(),selectedShips:new Set(),selectedBuilding:a.id});expect(vm.buildingVisible("armory")).toBe(false);expect(vm.buildingVisible("arms-factory")).toBe(true);expect(vm.buildingUpgrade()).toBeNull();
 });
 it("rejects legacy paid upgrade commands without spending and covers every building type",()=>{
   const game=fixture(),p=game.players[0],before=p.gold;
   expect(game.applyCommand({type:"upgrade-building",playerId:p.id,buildingIds:[game.buildings[0].id]})).toContain("automatically");expect(p.gold).toBe(before);
   for(const type of Object.keys(BUILDING_RULES))expect(AUTOMATIC_TIER_BUILDINGS).toContain(type);
 });
 it("binds pre-modern aircraft separately and keeps Tsar's visual footprint controlled",()=>{
   for(const kind of ["fighter","bomber"] as const){
     const early=aircraftArtworkId(kind,"EarlyModern"),modern=aircraftArtworkId(kind,"Modern");expect(early).not.toBe(modern);
     expect(ARTWORK_CATALOG[early].clips!.flight.file).not.toBe(ARTWORK_CATALOG[modern].clips!.flight.file);
   }
   const tsar=actors["EarlyModern:heavyCavalry"],t34=actors["EarlyModern:rangedCavalry"];
   expect(tsar.widthWorld*tsar.lengthWorld).toBeGreaterThan(t34.widthWorld*t34.lengthWorld);
   expect(tsar.widthWorld*tsar.lengthWorld).toBeLessThan(t34.widthWorld*t34.lengthWorld*1.6);
 });
});
