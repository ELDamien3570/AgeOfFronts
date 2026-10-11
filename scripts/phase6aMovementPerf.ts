import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { GameMapImpl } from "../src/core/game/GameMap";
import { Skirmish } from "../src/skirmish/Simulation";
import { FIXED } from "../src/skirmish/Protocol";
import { UNIT } from "../src/skirmish/content/Units";
import { createManpower } from "../src/skirmish/domain/Manpower";
import { createFormation, formationSlots } from "../src/skirmish/domain/FormationGeometry";

// The Phase 1 load's faction/position pattern with actual recipe-sized squads.
// The paired stationary control isolates the extra moving-reform certification.
const mode=process.argv[2]??"moving",trial=Number(process.argv[3]??0);
if(!["moving","stationary"].includes(mode))throw Error("Bad benchmark mode");
const results=[];
for(const [population,factions] of [[400,2],[1000,10]]) {
  const terrain=new Uint8Array(400*240).fill(133),map=new GameMapImpl(400,240,terrain,terrain.length);
  const game=new Skirmish(map,{seed:42,aiCount:factions-1,tribes:false,runAi:false,ruleset:"ages-v1",formationLocomotion:true});
  const template=structuredClone(game.squads[0]);for(const s of [...game.squads])game.removeSquad(s.id);
  const perFaction=population/factions;
  for(let at=0;at<population;at++) {
    const owner=Math.floor(at/perFaction)+1,member=at%perFaction;
    const id=["latemedieval-infantry","modern-infantry","latemedieval-cavalry"][member%3],unit=UNIT.get(id)!;
    const x=16+((owner-1)%5)*72+(member%10)*2,y=16+Math.floor((owner-1)/5)*96+Math.floor(member/10)*2;
    const destination=map.ref(x+20,y),count=unit.formationRecipe!.capacity;
    game.addSquad({...template,id:game.allocateId(),playerId:owner,definitionId:id,kind:unit.line,troops:count,manpower:createManpower(unit),formation:{...createFormation(id),layoutTroops:count},x:(x+.5)*FIXED,y:(y+.5)*FIXED,
      order:{type:"move",tile:destination},path:[destination],nextPathIndex:0,queuedOrders:[],combatTargetId:null,fighting:false,charge:null,refit:null,weaponState:undefined});
  }
  if(mode==="stationary") {
    const guards=game as unknown as {formationMoveClear:(s:typeof game.squads[number],end:{x:number;y:number})=>boolean};
    const clear=guards.formationMoveClear.bind(game);
    guards.formationMoveClear=(s,end)=>s.formation?.transition?false:clear(s,end);
  }
  const samples:number[]=[];let reformMoves=0;
  for(let tick=0;tick<200;tick++) {
    if(tick===40 || tick===120)for(const s of [...game.squads]){
      const old=s.formation!,shape=old.shape==="mass"?"line":"mass";
      if(s.definitionId?.startsWith("modern"))continue;
      game.updateSquad(s.id,{formation:{...old,shape,frontage:undefined,mode:"deployed",transition:{from:old.shape,fromFacing:old.facing,fromSlots:formationSlots(s,game.tick),startTick:game.tick,duration:80}}});
    }
    game.onPhase=tick<40?undefined:(name,ms)=>{if(name==="movement")samples.push(ms);};
    const previous=new Map(game.squads.filter(s=>s.formation?.transition).map(s=>[s.id,{x:s.x,y:s.y}]));
    game.step();for(const s of game.squads){const p=previous.get(s.id);if(p&&(p.x!==s.x||p.y!==s.y))reformMoves++;}
  }
  samples.sort((a,b)=>a-b);
  results.push({population,factions,samples:samples.length,p95:samples[Math.floor(samples.length*.95)],mean:samples.reduce((a,b)=>a+b,0)/samples.length,reformMoves});
}
const files=["src/skirmish/Simulation.ts","src/skirmish/domain/FormationGeometry.ts","src/skirmish/domain/FormationContact.ts","src/skirmish/domain/FormationProfiles.ts","src/skirmish/LocalAvoidance.ts","src/skirmish/FormationLocomotion.ts"];
const report={mode,trial,recordedAt:new Date().toISOString(),node:process.version,source:files.map(path=>({path,sha256:createHash("sha256").update(readFileSync(path)).digest("hex")})),results,qualification:"Headless paired moving-reform control; Phase 1 population/placement pattern adapted to recipe-sized squads. Not a historical before/after or rendered-load certification."};
writeFileSync(`.phase6a-perf-${mode}-${trial}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({mode,trial,results}));
