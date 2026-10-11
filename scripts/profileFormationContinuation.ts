import {readFileSync,writeFileSync} from 'node:fs';
import {deserialize} from 'node:v8';
import {Session} from 'node:inspector';
import {createHash} from 'node:crypto';
import {loadMap} from '../src/skirmish/Terrain';
import {Skirmish} from '../src/skirmish/Simulation';
globalThis.fetch=async(input:any)=>{const p=String(input);if(!/^\/maps\/[a-z0-9-]+\/[a-z0-9.-]+$/.test(p))throw Error(p);return new Response(readFileSync(`resources${p}`));};
const root=process.argv[3]??'out/profile-14ai-napoleonic',saved=deserialize(readFileSync(`${root}/seed-42-plain-checkpoint.v8`));
const loaded=await loadMap('heightmap-test1',500,42),game=new Skirmish(loaded.map,saved.options);game.restore(saved);
const stats=(xs:number[])=>{const s=xs.slice().sort((a,b)=>a-b);return{n:s.length,mean:xs.reduce((a,b)=>a+b,0)/xs.length,p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)};};
const phases:Record<string,number[]>={},times:number[]=[],counts:Record<string,{calls:number;ms:number}>={};let measuring=false;
game.onPhase=(n,ms)=>{if(measuring)(phases[n]??=[]).push(ms);};
for(const name of ['formationFits','certifyFormationPolygon','formationMoveClear','transportProposal','transportStepClear','advanceFormationStates','navigation']){
 const original=(game as any)[name];if(typeof original!=='function')continue;
 counts[name]={calls:0,ms:0};(game as any)[name]=function(...args:any[]){const at=performance.now();try{return original.apply(this,args);}finally{if(measuring){counts[name].calls++;counts[name].ms+=performance.now()-at;}}};
}
const session=new Session();session.connect();const post=(name:string,args:any={})=>new Promise<any>((resolve,reject)=>session.post(name as any,args,(e,r)=>e?reject(e):resolve(r)));
if(process.argv[4]==='cpu'){await post('Profiler.enable');await post('Profiler.start');}
for(let i=0;i<220;i++){measuring=i>=20;const at=performance.now();game.step();if(measuring)times.push(performance.now()-at);}
if(process.argv[4]==='cpu'){const {profile}=await post('Profiler.stop');writeFileSync(`${root}/${process.argv[2]??'continuation'}.cpuprofile`,JSON.stringify(profile));}session.disconnect();
const result={startTick:saved.tick,endTick:game.tick,squads:game.squads.length,ships:game.ships.length,afloat:game.squads.filter(s=>s.afloat).length,simulation:stats(times),phases:Object.fromEntries(Object.entries(phases).map(([k,v])=>[k,stats(v)])),methodCalls:Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,{callsPerTick:v.calls/times.length,inclusiveMsPerTick:v.ms/times.length}])),limitations:'Same saved match continued with 20 warmup ticks; no CPU sampling, no rendering or snapshot encoding; method timers overlap and cannot be added together.'};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_key,row)=>{
 if(row instanceof Map)return {entries:[...row]};if(row instanceof Set)return {values:[...row]};
 if(ArrayBuffer.isView(row))return Array.from(row as Uint8Array);
 if(row && typeof row==='object' && !Array.isArray(row))return Object.fromEntries(Object.entries(row).sort(([a],[b])=>a<b?-1:a>b?1:0));return row;
})).digest('hex');
const evidence={...result,sourceHashes:Object.fromEntries(['Simulation.ts','UnitIndex.ts','LandingOccupancy.ts','domain/Battle.ts','domain/CombatGeometry.ts','domain/CombatActivity.ts','domain/FormationContact.ts']
 .map(path=>[path,createHash('sha256').update(readFileSync(new URL(`../src/skirmish/${path}`,import.meta.url))).digest('hex')])),snapshotHash:digest(game.snapshot()),checkpointHash:digest(game.checkpoint())};
writeFileSync(`${root}/${process.argv[2]??'continuation'}.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
