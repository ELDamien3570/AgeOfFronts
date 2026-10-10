import {writeFileSync,readFileSync} from "node:fs";
import {GameMapImpl} from "../../src/core/game/GameMap";
import {Skirmish} from "../../src/skirmish/Simulation";
import {DEFAULT_AI_POLICIES} from "../../src/skirmish/content/AiPolicies";
import {TECHNOLOGIES,ADVANCES} from "../../src/skirmish/content/Technology";
const seed=Number(process.argv[2] ?? 47),label=process.argv[3] ?? "baseline";
const economic=process.argv[4]==="economic";
if(label==="old-timing") {
  const changes=JSON.parse(readFileSync("tmp/formation-pacing-timing-changes.json","utf8")) as {id:string;before:number}[];
  for(const change of changes)TECHNOLOGIES.find(t=>t.id===change.id)!.ticks=change.before*20;
  for(const quote of ADVANCES)(quote as {ticks:number}).ticks-=300;
}
const width=128,height=96,terrain=new Uint8Array(width*height).fill(133);
const game=new Skirmish(new GameMapImpl(width,height,terrain,terrain.length),{seed,aiCount:1,tribes:false,runAi:true,ruleset:"ages-v1",startingAge:"StoneAge",technologySpeed:1,...DEFAULT_AI_POLICIES});
game.players[0].ai=true;
// Controlled economic diagnostic: no combat or free resources. This does not
// certify pacing in contested matches and never changes production gameplay.
if(economic)game.expansion!.diplomacy.hostile=()=>false;
const rows=game.players.map(p=>({id:p.id,ages:[{age:"StoneAge",seconds:0}],researchTicks:0,goldWaitTicks:0}));
const started=performance.now();
function report(){writeFileSync(`tmp/formation-pacing-${label}-${seed}.json`,JSON.stringify({seed,label,tick:game.tick,seconds:game.tick/20,wallSeconds:(performance.now()-started)/1000,winner:game.winner,rows,players:game.players.map(p=>({id:p.id,gold:p.gold,land:p.land,squads:game.squadFacts().byOwner(p.id).map(s=>s.definitionId)}))},null,2));}
for(let tick=0;tick<72000;tick++){
  game.step();
  for(const row of rows){const state=game.expansion!.progression.states[row.id];if(row.ages[row.ages.length-1]?.age!==state.age)row.ages.push({age:state.age,seconds:game.tick/20});if(Object.keys(state.research).length||state.advancement)row.researchTicks++;else row.goldWaitTicks++;}
  if(tick%1200===0)report();
  if(rows.every(r=>r.ages[r.ages.length-1]?.age==="Modern"))break;
  if(game.winner!==null)break;
}
report();console.log(JSON.stringify(rows));
