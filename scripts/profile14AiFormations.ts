import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Session } from 'node:inspector';
import { serialize } from 'node:v8';
import { loadMap } from '../src/skirmish/Terrain';
import { Skirmish } from '../src/skirmish/Simulation';
import { DEFAULT_AI_POLICIES } from '../src/skirmish/content/AiPolicies';
import { FORMATION_MOVEMENT } from '../src/skirmish/content/FormationMovement';
import { SnapshotEncoder } from '../src/skirmish/SnapshotCodec';

// Offline adapter for the exact production terrain loader. No network requests.
globalThis.fetch=async(input:any)=>{
  const path=String(input);
  if(!/^\/maps\/[a-z0-9-]+\/[a-z0-9.-]+$/.test(path))throw Error(`Unexpected asset ${path}`);
  return new Response(readFileSync(`resources${path}`));
};
const output=process.argv[5]??'out/profile-14ai-napoleonic';mkdirSync(output,{recursive:true});
const seed=Number(process.argv[2]??42),maxTicks=Number(process.argv[3]??1800);
const sampling=process.argv[4]!=='plain',tag=`seed-${seed}${sampling?'':'-plain'}`;
const loaded=await loadMap('heightmap-test1',500,seed);
const game=new Skirmish(loaded.map,{...DEFAULT_AI_POLICIES,...FORMATION_MOVEMENT,
 seed,aiCount:14,tribes:true,ruleset:'ages-v1',startingAge:'Napoleonic',territoryIncomeScale:loaded.territoryIncomeScale});
const phases:Record<string,number[]>={},steps:number[]=[],encoding:number[]=[],windows:any[]=[];
const stats=(xs:number[])=>{const s=xs.slice().sort((a,b)=>a-b);return{n:s.length,mean:xs.reduce((a,b)=>a+b,0)/xs.length,p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1),over50:xs.filter(x=>x>50).length};};
game.onPhase=(name,ms)=>{if(game.tick>60)(phases[name]??=[]).push(ms);};
const encoder=new SnapshotEncoder();encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts());
const session=new Session();session.connect();
const post=(name:string,args:any={})=>new Promise<any>((resolve,reject)=>session.post(name as any,args,(e,r)=>e?reject(e):resolve(r)));
if(sampling){await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});await post('Profiler.start');}
const started=performance.now();let windowStart=0;
for(let i=0;i<maxTicks && game.winner===null;i++){
 const start=performance.now();game.step();if(i>=60)steps.push(performance.now()-start);
 if(i%4===0){const start=performance.now();encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts());if(i>=60)encoding.push(performance.now()-start);}
 if((i+1)%200===0){const w={tick:game.tick,squads:game.squads.length,ships:game.ships.length,buildings:game.buildings.length,fighting:game.squads.filter(s=>s.fighting).length,moving:game.squads.filter(s=>s.order.type!=='hold').length,simulation:stats(steps.slice(windowStart))};windowStart=steps.length;windows.push(w);console.log(JSON.stringify(w));}
 if(performance.now()-started>180000)break;
}
if(sampling){const {profile}=await post('Profiler.stop');writeFileSync(`${output}/${tag}.cpuprofile`,JSON.stringify(profile));}session.disconnect();
writeFileSync(`${output}/${tag}-checkpoint.v8`,serialize(game.checkpoint()));
const result={seed,map:loaded.name,options:game.options,ticks:game.tick,wallMs:performance.now()-started,simulation:stats(steps),encoding:stats(encoding),phases:Object.fromEntries(Object.entries(phases).map(([k,v])=>[k,stats(v)])),windows,final:{squads:game.squads.length,ships:game.ships.length,buildings:game.buildings.length},limitations:`Headless production simulation and uncompressed snapshot encode; no browser render/GPU or network. CPU sampling ${sampling?'enabled; timing includes profiler overhead':'disabled'}.`};
writeFileSync(`${output}/${tag}.json`,JSON.stringify({...result,sampling},null,2));console.log(JSON.stringify(result));
