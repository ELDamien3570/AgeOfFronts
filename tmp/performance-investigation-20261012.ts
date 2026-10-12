import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {deserialize,serialize} from 'node:v8';
import {Session} from 'node:inspector';
import {generateMigration} from '../src/skirmish/MigrationMap';
import {Skirmish} from '../src/skirmish/Simulation';
import {SnapshotEncoder} from '../src/skirmish/SnapshotCodec';
const mode=process.argv[2]??'plain';
const saved=deserialize(readFileSync(process.argv[4]??'out/migration-opening-profile/seed-504565698-checkpoint.v8'));
const loaded=generateMigration(1000,504565698), game=new Skirmish(loaded.map,saved.options);
if(process.argv[3]==='fresh'){
 let marker=performance.now();
 for(let i=0;i<saved.tick;i++){game.step();if(performance.now()-marker>20000){console.log(JSON.stringify({warmingToCapturedTick:game.tick,squads:game.squads.length}));marker=performance.now();}if(i%20===19)await new Promise(r=>setImmediate(r));}
 mkdirSync('out/performance-investigation-20261012',{recursive:true});writeFileSync('out/performance-investigation-20261012/fresh-checkpoint.v8',serialize(game.checkpoint()));
}else game.restore(saved);
const encoder=new SnapshotEncoder();encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts());
const rows:any[]=[],methods:Record<string,{calls:number;ms:number;max:number}>={};let row:any,measuring=false;
game.onPhase=(name,ms)=>{if(row)row.phases[name]=ms;};
if(mode==='instrument'){
 for(const [owner,names] of [[game,['formationMoveClear','certifyFormationPolygon','formationFits','transportProposal','transportStepClear','advanceFormationStates','navigation']],[(game as any).squadIndex,['changed']],[(game as any).paths,['hierarchical']],[(game as any).waterPaths,['hierarchical']]] as any[]){
  for(const name of names){const original=owner[name];if(typeof original!=='function')continue;
   const key=owner===game?name:owner===(game as any).squadIndex?'index.changed':(owner===(game as any).paths?'land.':'water.')+name;
   methods[key]={calls:0,ms:0,max:0};owner[name]=function(...args:any[]){const at=performance.now();try{return original.apply(this,args);}finally{if(measuring){const ms=performance.now()-at,m=methods[key];m.calls++;m.ms+=ms;m.max=Math.max(m.max,ms);if(name==='hierarchical')row.corridors.push({key,ms,start:args[0],goal:args[1]});}}};
  }
 }
}
const session=new Session();const post=(name:string,args:any={})=>new Promise<any>((resolve,reject)=>session.post(name as any,args,(e,r)=>e?reject(e):resolve(r)));
for(let i=0;i<20;i++)game.step();
if(mode==='cpu'){session.connect();await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});await post('Profiler.start');}
const start={tick:game.tick,squads:game.squads.length,ships:game.ships.length};
for(let i=0;i<200;i++){
 measuring=true;row={tick:game.tick+1,phases:{},corridors:[]};let at=performance.now();game.step();row.simulation=performance.now()-at;
 at=performance.now();encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts());row.encoding=performance.now()-at;row.total=row.simulation+row.encoding;row.squadReads=encoder.diagnostics.squadReads;rows.push(row);row=undefined;
 if(i%20===19)await new Promise(r=>setImmediate(r));
}
const output='out/performance-investigation-20261012';mkdirSync(output,{recursive:true});
if(mode==='cpu'){const {profile}=await post('Profiler.stop');writeFileSync(`${output}/migration.cpu.json`,JSON.stringify(profile));session.disconnect();}
const stats=(xs:number[])=>{const s=xs.slice().sort((a,b)=>a-b);return{n:s.length,mean:xs.reduce((a,b)=>a+b,0)/xs.length,p95:s[Math.ceil(s.length*.95)-1],p99:s[Math.ceil(s.length*.99)-1],max:s.at(-1),over50:xs.filter(x=>x>50).length};};
const result={mode,node:process.version,start,end:{tick:game.tick,squads:game.squads.length,ships:game.ships.length},simulation:stats(rows.map(r=>r.simulation)),encoding:stats(rows.map(r=>r.encoding)),total:stats(rows.map(r=>r.total)),phases:Object.fromEntries(Object.keys(rows[0].phases).map(k=>[k,stats(rows.map(r=>r.phases[k]))])),methods:Object.fromEntries(Object.entries(methods).map(([k,v])=>[k,{callsPerTick:v.calls/200,inclusiveMsPerTick:v.ms/200,max:v.max}])),squadReads:stats(rows.map(r=>r.squadReads)),worst:rows.slice().sort((a,b)=>b.total-a.total).slice(0,5),limitations:'20 warmup + 200 measured ticks from saved checkpoint. Encode every measured tick. No browser, sockets, compression, hosted verification or command-latency probe. Method timers overlap; cpu mode adds sampling overhead.'};
writeFileSync(`${output}/${mode}.json`,JSON.stringify(result,null,2));writeFileSync(`${output}/${mode}-ticks.json`,JSON.stringify(rows));console.log(JSON.stringify(result));
