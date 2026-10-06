import fs from "node:fs";
import path from "node:path";
import { deserialize } from "node:v8";
import { createHash } from "node:crypto";
import { Session } from "node:inspector";
import { PerformanceObserver, monitorEventLoopDelay } from "node:perf_hooks";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap.ts";
import { defaultLobbySettings } from "../src/skirmish/lobby/LobbyDirectory.ts";
import { createSkirmishMap } from "../src/skirmish/Elevation.ts";
import { Skirmish } from "../src/skirmish/Simulation.ts";
import { SnapshotEncoder } from "../src/skirmish/SnapshotCodec.ts";

const args=process.argv.slice(2),arg=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
const out=arg("--out","out/local-diagnostics/hitches"),ticks=Number(arg("--ticks","1600")),profile=args.includes("--profile");
if(!Number.isSafeInteger(ticks)||ticks<400||ticks>6000)throw new Error("Expected 400..6000 continuation ticks");
fs.mkdirSync(out,{recursive:true});
const input=fs.readFileSync("out/overnight-1000/seed42-filtered/checkpoint-60000.v8"),saved=deserialize(input);
const loaded=await loadServerMap(defaultLobbySettings("old-world",1000)),data=structuredClone(loaded.map);
const game=new Skirmish(createSkirmishMap(data.width,data.height,data.terrain,data.elevation,data.forest,data.resourceTerrain),saved.options);
game.restore(saved);
const encoder=new SnapshotEncoder(true),rows=[],gc=[],memory=[],subphases={};
let current;
game.onPhase=(phase,ms)=>{if(current)current.phases[phase]=ms;};
// Diagnostic-only method wrappers; clocks never affect planner work or gameplay.
for(const [name,owner,key] of [["landWarm",game.paths,"warm"],["waterWarm",game.waterPaths,"warm"],
  ["routeStep",game.routePlanner,"step"],["capture",game,"capture"],["battle",game.expansion.battle,"step"],
  ["tradePlanning",game.expansion.trade,"stepPlanning"]]){
  if(typeof owner[key]!=="function")continue;
  const original=owner[key].bind(owner);
  owner[key]=(...parameters)=>{const start=performance.now();try{return original(...parameters);}finally{const ms=performance.now()-start;if(current)current.subphases[name]=(current.subphases[name]??0)+ms;(subphases[name]??=[]).push(ms);}};
}
const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({start:e.startTime,duration:e.duration,kind:e.detail?.kind});});
observer.observe({entryTypes:["gc"]});
const delay=monitorEventLoopDelay({resolution:10});delay.enable();
const session=new Session();const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(error,result)=>error?reject(error):resolve(result)));
let cpuStart=0;
if(profile){session.connect();await post("Profiler.enable");await post("Profiler.setSamplingInterval",{interval:1000});
  await post("HeapProfiler.startSampling",{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
  const before=performance.now();await post("Profiler.start");cpuStart=(before+performance.now())/2;}
const start=performance.now();let failure;
try{
  for(let at=0;at<ticks;at++){
    current={tick:game.tick+1,start:performance.now(),phases:{},subphases:{}};
    game.step();current.end=performance.now();current.ms=current.end-current.start;
    if(at%4===0){const before=performance.now();encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts());current.snapshotMs=performance.now()-before;}
    rows.push(current);current=undefined;
    if(at%100===0)memory.push({tick:game.tick,at:performance.now(),...process.memoryUsage()});
    if(at%4===3)await new Promise(resolve=>setImmediate(resolve));
    if((at+1)%400===0)console.log(JSON.stringify({profile,tick:game.tick,elapsedMs:performance.now()-start}));
  }
}catch(error){failure={message:error.message,stack:error.stack};}
await new Promise(resolve=>setImmediate(resolve));
let cpu,heap;
if(profile){cpu=(await post("Profiler.stop")).profile;heap=(await post("HeapProfiler.stopSampling")).profile;session.disconnect();}
delay.disable();observer.disconnect();
const summary=xs=>{if(!xs.length)return undefined;const s=xs.slice().sort((a,b)=>a-b);return{samples:xs.length,mean:xs.reduce((a,b)=>a+b,0)/xs.length,p95:s[Math.ceil(xs.length*.95)-1],p99:s[Math.ceil(xs.length*.99)-1],maximum:s.at(-1)};};
const nodeNames=new Map(cpu?.nodes.map(n=>[n.id,{function:n.callFrame.functionName||"(anonymous)",url:n.callFrame.url,line:n.callFrame.lineNumber+1}])??[]);
const self=new Map(),sampleTimes=[];let elapsed=0;
for(let i=0;i<(cpu?.samples.length??0);i++){elapsed+=cpu.timeDeltas[i]/1000;const id=cpu.samples[i];self.set(id,(self.get(id)??0)+1);sampleTimes.push({at:cpuStart+elapsed,id});}
const tops=counts=>[...counts].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([id,samples])=>({...nodeNames.get(id),samples,percent:samples*100/[...counts.values()].reduce((a,b)=>a+b,0)}));
for(const row of rows){row.gc=gc.filter(e=>e.start<row.end&&e.start+e.duration>row.start);row.gcOverlapMs=row.gc.reduce((total,e)=>total+Math.max(0,Math.min(row.end,e.start+e.duration)-Math.max(row.start,e.start)),0);}
const hitches=rows.filter(r=>r.ms>50).map(row=>{const counts=new Map();for(const s of sampleTimes)if(s.at>=row.start&&s.at<=row.end)counts.set(s.id,(counts.get(s.id)??0)+1);return{...row,cpu:tops(counts)};});
const allocations=[];function visit(n){if(n.selfSize)allocations.push({function:n.callFrame.functionName||"(anonymous)",url:n.callFrame.url,line:n.callFrame.lineNumber+1,sampledBytes:n.selfSize});for(const child of n.children??[])visit(child);}if(heap)visit(heap.head);
const digest=value=>createHash("sha256").update(JSON.stringify(value,(_key,row)=>row instanceof Map?{entries:[...row]}:row instanceof Set?{values:[...row]}:ArrayBuffer.isView(row)?Array.from(row):row&&typeof row==="object"&&!Array.isArray(row)?Object.fromEntries(Object.entries(row).sort(([a],[b])=>a<b?-1:a>b?1:0)):row)).digest("hex");
const result={profile,node:process.version,initialTick:saved.tick,finalTick:game.tick,inputSha256:createHash("sha256").update(input).digest("hex"),elapsedMs:performance.now()-start,
  step:summary(rows.map(r=>r.ms)),coldFirst20:summary(rows.slice(0,20).map(r=>r.ms)),warmAfter80:summary(rows.slice(80).map(r=>r.ms)),
  phases:Object.fromEntries(Object.keys(rows[0]?.phases??{}).map(k=>[k,summary(rows.map(r=>r.phases[k]))])),subphases:Object.fromEntries(Object.entries(subphases).map(([k,v])=>[k,summary(v)])),
  gc:{...summary(gc.map(e=>e.duration)),totalMs:gc.reduce((a,b)=>a+b.duration,0),hitchesWithGC:hitches.filter(r=>r.gcOverlapMs>0).length},
  hitches,cpuTop:tops(self),allocationTop:allocations.sort((a,b)=>b.sampledBytes-a.sampledBytes).slice(0,30),sampledAllocationBytes:allocations.reduce((a,b)=>a+b.sampledBytes,0),
  eventLoopDelay:{meanMs:delay.mean/1e6,p95Ms:delay.percentile(95)/1e6,maxMs:delay.max/1e6},memory,
  entities:{squads:game.squads.length,buildings:game.buildings.length,ships:game.ships.length,traders:game.expansion.trade.actors.length},
  snapshotHash:digest(game.snapshot()),checkpointHash:digest(game.checkpoint()),failure,
  limitations:"Headless fixed-step continuation; profiling and diagnostic wrappers add overhead. Sampled bytes estimate JS allocations, not retained heap or total process allocation. CPU-to-tick alignment is approximate within inspector-start latency; GC overlap uses perf_hooks timestamps. First 80 ticks separated as cold. Event-loop delay reflects this unpaced batch harness, not a live server."};
fs.writeFileSync(path.join(out,"summary.json"),JSON.stringify(result,null,2));fs.writeFileSync(path.join(out,"ticks.json"),JSON.stringify(rows));
if(cpu)fs.writeFileSync(path.join(out,"simulation.cpuprofile"),JSON.stringify(cpu));if(heap)fs.writeFileSync(path.join(out,"allocations.heapprofile"),JSON.stringify(heap));
console.log(JSON.stringify({profile,step:result.step,warm:result.warmAfter80,hitches:hitches.length,gc:result.gc,hash:result.checkpointHash,failure}));
if(failure)process.exitCode=1;
