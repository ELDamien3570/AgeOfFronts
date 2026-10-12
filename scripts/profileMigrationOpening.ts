import {mkdirSync,writeFileSync} from 'node:fs';
import {serialize} from 'node:v8';
import {Session} from 'node:inspector';
import {PerformanceObserver} from 'node:perf_hooks';
import {generateMigration} from '../src/skirmish/MigrationMap';
import {Skirmish} from '../src/skirmish/Simulation';
import {DEFAULT_AI_POLICIES} from '../src/skirmish/content/AiPolicies';
import {FORMATION_MOVEMENT} from '../src/skirmish/content/FormationMovement';
import {SnapshotEncoder} from '../src/skirmish/SnapshotCodec';
const output='out/migration-opening-profile';mkdirSync(output,{recursive:true});
const seed=Number(process.argv[2]??42),limit=Number(process.argv[3]??3600),sample=process.argv[4]!=='plain';
const stats=(xs:number[])=>{const s=xs.slice().sort((a,b)=>a-b);return{n:s.length,mean:xs.reduce((a,b)=>a+b,0)/Math.max(1,xs.length),p95:s[Math.ceil(s.length*.95)-1],p99:s[Math.ceil(s.length*.99)-1],max:s.at(-1),over50:xs.filter(x=>x>50).length};};
let start=performance.now();const loaded=generateMigration(1000,seed);const mapMs=performance.now()-start;
start=performance.now();const game=new Skirmish(loaded.map,{...DEFAULT_AI_POLICIES,...FORMATION_MOVEMENT,seed,aiCount:14,tribes:true,ruleset:'ages-v1',startingAge:'StoneAge',territoryIncomeScale:loaded.territoryIncomeScale});
const setupMs=performance.now()-start;console.log(JSON.stringify({mapMs,setupMs,players:game.players.length,squads:game.squads.length}));
const rows:any[]=[],encodes:number[]=[],gc:any[]=[];let row:any;
game.onPhase=(phase,ms)=>{if(row)row.phases[phase]=ms;};
const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({start:e.startTime,duration:e.duration});});observer.observe({entryTypes:['gc']});
const encoder=new SnapshotEncoder(),session=new Session();session.connect();
const post=(name:string,args:any={})=>new Promise<any>((resolve,reject)=>session.post(name as any,args,(e,r)=>e?reject(e):resolve(r)));
if(sample){await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});await post('Profiler.start');}
const began=performance.now();let failure;
let lastProgressMarker='';
const checkpointMethods=['navigation','advanceFormationStates','capture','drainRoutes'];
for(const key of checkpointMethods){const original=(game as any)[key];if(typeof original==='function')(game as any)[key]=function(...args:any[]){const marker=`${game.tick}:${key}`;if(game.tick>=5000&&marker!==lastProgressMarker){lastProgressMarker=marker;writeFileSync(`${output}/seed-${seed}-progress.json`,JSON.stringify({tick:game.tick,method:key}));}return original.apply(this,args);};}
try{for(let i=0;i<limit&&game.winner===null;i++){
 row={tick:game.tick+1,phases:{}};const at=performance.now();game.step();row.ms=performance.now()-at;
 if(i%4===0){const before=performance.now();encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts());row.encode=performance.now()-before;encodes.push(row.encode);}
 rows.push(row);row=undefined;
 if((i+1)%400===0){writeFileSync(`${output}/seed-${seed}-checkpoint.v8`,serialize(game.checkpoint()));}
 if((i+1)%400===0)console.log(JSON.stringify({tick:game.tick,squads:game.squads.length,buildings:game.buildings.length,steps:stats(rows.slice(-400).map(r=>r.ms)),elapsedMs:performance.now()-began}));
 if(i%20===19)await new Promise(resolve=>setImmediate(resolve));
 if(performance.now()-began>600000)break;
}}catch(e){failure=String(e);}
let cpu:any;if(sample){cpu=(await post('Profiler.stop')).profile;writeFileSync(`${output}/seed-${seed}.cpuprofile`,JSON.stringify(cpu));}session.disconnect();observer.disconnect();
const cpuNodes=new Map<number,any>(cpu?.nodes.map((n:any)=>[n.id,n])??[]);
const totals=new Map<string,number>();if(cpu)for(let i=0;i<cpu.samples.length;i++){const n=cpuNodes.get(cpu.samples[i]);const key=`${n.callFrame.functionName} ${n.callFrame.url}:${n.callFrame.lineNumber+1}`;totals.set(key,(totals.get(key)??0)+(cpu.timeDeltas[i]??0)/1000);}
const phases=[...new Set(rows.flatMap(r=>Object.keys(r.phases)))];
const result={seed,map:'Migration',size:1000,age:'StoneAge',aiCount:14,tribes:true,sample,mapMs,setupMs,ticks:game.tick,wallMs:performance.now()-began,step:stats(rows.map(r=>r.ms)),encode:stats(encodes),phases:Object.fromEntries(phases.map(p=>[p,stats(rows.map(r=>r.phases[p]).filter(x=>x!==undefined))])),worst:rows.slice().sort((a,b)=>b.ms-a.ms).slice(0,15),cpuTop:[...totals].sort((a,b)=>b[1]-a[1]).slice(0,35),gc:{count:gc.length,totalMs:gc.reduce((n,r)=>n+r.duration,0),max:Math.max(0,...gc.map(r=>r.duration))},memory:process.memoryUsage(),entities:{squads:game.squads.length,buildings:game.buildings.length},failure,limitations:'Headless production simulation and snapshot encoding. No renderer, GPU or sockets; profiling adds overhead; one seed, local Windows machine.'};
writeFileSync(`${output}/seed-${seed}${sample?'':'-plain'}.json`,JSON.stringify(result,null,2));writeFileSync(`${output}/seed-${seed}${sample?'':'-plain'}-ticks.json`,JSON.stringify(rows));console.log(JSON.stringify(result));
