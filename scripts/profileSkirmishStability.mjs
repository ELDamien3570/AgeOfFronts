import {serialize,deserialize} from "node:v8";
import fs from "node:fs";
import path from "node:path";
import { Session } from "node:inspector";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap.ts";
import { defaultLobbySettings } from "../src/skirmish/lobby/LobbyDirectory.ts";
import { createSkirmishMap } from "../src/skirmish/Elevation.ts";
import { Skirmish } from "../src/skirmish/Simulation.ts";
import { RuntimeDiagnostics } from "../src/skirmish/RuntimeDiagnostics.ts";
import { encodeState, decodeState } from "../src/skirmish/multiplayer/StateCodec.ts";
import { SnapshotEncoder } from "../src/skirmish/SnapshotCodec.ts";
import { SnapshotEncodingWorker } from "../src/skirmish/multiplayer/infrastructure/SnapshotEncodingWorker.ts";
import { PublicationQueue } from "../src/skirmish/multiplayer/application/PublicationQueue.ts";

const args = process.argv.slice(2);
const value = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
const out = value("--out", "data/investigation-20261003/local-baseline");
fs.mkdirSync(out, { recursive: true });
const allAi = args.includes("--all-ai");
const settings = { ...defaultLobbySettings(value("--map", "valles-kairulia"), Number(value("--size", "500"))), aiCount:10, tribeCount:25 };
const loaded = await loadServerMap(settings);
const options = {seed:Number(value("--seed", "42")), aiCount:10, tribeCount:25, tribes:true, ruleset:"ages-v1", territoryIncomeScale:loaded.territoryIncomeScale, startingAge:value("--age", "StoneAge"),
  humanNames: Array.from({length:Number(value("--humans", "1"))},(_,i)=>`Benchmark ${i+1}`),
  ...(allAi ? {aiEconomy:true,deferredPlanning:true,aiDefenses:true,aiNaval:true,aiWarPolicy:true}: {})};
const map = createSkirmishMap(loaded.map.width, loaded.map.height, loaded.map.terrain, loaded.map.elevation, loaded.map.forest, loaded.map.resourceTerrain);
const game = new Skirmish(map, options);
const restore = value("--restore");
if (restore) {
  const saved = restore.endsWith(".v8") ? deserialize(fs.readFileSync(restore)) : await decodeState(JSON.parse(fs.readFileSync(restore, "utf8")));
  if(allAi) Object.assign(saved.options, options);
  game.restore(saved);
}
const navigationOrigin = args.includes("--inspect-navigation") ? {
  squads:game.squads.map(s=>({id:s.id,x:s.x,y:s.y})),
  ships:game.ships.map(s=>({id:s.id,x:s.x,y:s.y})),
  traders:game.expansion?.trade.actors.map(s=>({id:s.id,x:s.x,y:s.y}))??[]
} : undefined;
const shipTrips = new Map(navigationOrigin?.ships.map(s=>[s.id,{...s,maximum:0,phases:new Set()}])??[]);
const navigation = () => navigationOrigin ? {
  squads: navigationOrigin.squads.map(p=>{const s=game.squad(p.id);return s?{id:s.id,delta:Math.round(Math.hypot(s.x-p.x,s.y-p.y)),order:s.order,embarkedOn:s.embarkedOn}: {id:p.id,removed:true};}),
  ships: game.ships.map(s=>{const p=navigationOrigin.ships.find(p=>p.id===s.id);return {id:s.id,playerId:s.playerId,kind:s.kind,delta:p?Math.round(Math.hypot(s.x-p.x,s.y-p.y)):null,destination:s.destination,transfer:s.shoreTransfer?.phase,boarding:s.boarding};}),
  traders: game.expansion?.trade.actors.map(s=>{const p=navigationOrigin.traders.find(p=>p.id===s.id);return {id:s.id,playerId:s.playerId,naval:s.naval,delta:p?Math.round(Math.hypot(s.x-p.x,s.y-p.y)):null,state:s.state,destination:s.destination,stops:s.stops};}),
  shipTrips:[...shipTrips.values()].map(s=>({...s,phases:[...s.phases]})),
  shore:game.checkpoint().shorePlanning,
} : undefined;
const phases = new RuntimeDiagnostics(256, true);
const armyTimings = new Map();
game.onPhase = (phase, ms) => phases.record(phase, ms);
// Optional benchmark-only hooks. No production policy is changed by observation.
const churn = {built:0,captured:0,capturedWithin30Seconds:0,removed:0,commands:{},rejected:{},rejectionReasons:{},buildsByOwner:{},capturesByPreviousOwner:{},commandMilliseconds:{}};
const births = new Map();
if(args.includes("--inspect-churn")) {
  for(const method of ["addBuilding","updateBuilding","removeBuilding","applyCommand"]) {
    const original=game[method].bind(game);
    game[method]=(...parameters)=>{
      const before=method==="updateBuilding"?game.building(parameters[0])?.playerId:undefined;
      const started=method==="applyCommand"?performance.now():0;
      const result=original(...parameters);
      if(method==="addBuilding"){churn.built++;births.set(parameters[0].id,game.tick);const owner=parameters[0].playerId;churn.buildsByOwner[owner]=(churn.buildsByOwner[owner]??0)+1;}
      if(method==="removeBuilding"&&result)churn.removed++;
      if(method==="updateBuilding"&&result&&before!==result.playerId){churn.captured++;churn.capturesByPreviousOwner[before]=(churn.capturesByPreviousOwner[before]??0)+1;if(game.tick-(births.get(result.id)??-Infinity)<=600)churn.capturedWithin30Seconds++;}
      if(method==="applyCommand"){const type=parameters[0].type;churn.commands[type]=(churn.commands[type]??0)+1;churn.commandMilliseconds[type]=(churn.commandMilliseconds[type]??0)+performance.now()-started;if(result){churn.rejected[type]=(churn.rejected[type]??0)+1;const key=`${type}: ${result}`;churn.rejectionReasons[key]=(churn.rejectionReasons[key]??0)+1;}}
      return result;
    };
  }
  if(game.expansion)for(const method of ["step","stepPlanning","reconcile","command"]) {
    const timing=new RuntimeDiagnostics(256,true);armyTimings.set(method,timing);
    const original=game.expansion.armies[method].bind(game.expansion.armies);
    game.expansion.armies[method]=(...parameters)=>timing.measure("tick",()=>original(...parameters));
  }
}
const experiment=value("--experiment","baseline");
if(args.includes("--filter-stale-transport-candidates")&&game.expansion){
  // Diagnostic policy prototype only: revalidate uncommitted candidates as
  // the resumable assessment crosses ticks. Never rewrite committed cargo.
  const transports=game.expansion.economy.transports,original=transports.step.bind(transports);
  transports.step=(...parameters)=>{
    for(const mission of transports.missions.values())if(mission.phase==="assess"){
      const port=game.building(mission.port);
      mission.eligible=mission.eligible.filter(id=>{const s=game.squad(id);return !!s&&s.playerId===mission.playerId&&s.troops>=700&&s.embarkedOn===null&&!s.refit&&!s.charge&&!s.fighting&&s.order.type==="hold"&&!game.expansion.armies.armyOf(id)&&!game.expansion.economy.assets.held(`squad:${id}`)&&!!port&&game.paths.connected(game.tileOf(s),port.tile);});
      for(const key of ["transports","escorts"])mission[key]=mission[key].filter(id=>game.ship(id)?.playerId===mission.playerId);
    }
    return original(...parameters);
  };
}
if(!["baseline","no-trade-planning","no-armies","no-ai-construction"].includes(experiment))throw new Error("Unknown diagnostic experiment");
if(experiment==="no-trade-planning"&&game.expansion){
  for(const actor of game.expansion.trade.actors)game.expansion.trade.cancel(actor.id);
  game.expansion.trade.stepPlanning=()=>0;
}
if(experiment==="no-armies"&&game.expansion){
  game.expansion.economy.military.step=()=>0;
  for(const army of [...game.expansion.armies.armies])game.applyCommand({type:"disband-army",playerId:army.playerId,armyId:army.id});
}
if(experiment==="no-ai-construction"){
  const original=game.applyCommand.bind(game);
  game.applyCommand=command=>command.type==="build"&&game.player(command.playerId)?.ai?"Diagnostic experiment: AI construction suppressed":original(command);
}
const encoder = new SnapshotEncoder(true);
const encodingWorker=args.includes("--worker-encoding")?new SnapshotEncodingWorker():undefined;
let published=0,encodedBytes=0,publicationFailure;
const publications=encodingWorker?new PublicationQueue(packet=>phases.measureAsync("encoding",()=>encodingWorker.encode(packet)),(_tick,packet)=>{published++;encodedBytes+=packet.payload.length;},error=>{publicationFailure=error;}):undefined;
const total = Number(value("--ticks", "42000"));
const profileAt = Number(value("--profile-at", "24000"));
const session = new Session();
session.connect();
const post = (method) => new Promise((resolve,reject)=>session.post(method,(error,result)=>error?reject(error):resolve(result)));
let profiling = false;
let finished = false;
const started = performance.now();
const summary = () => ({tick:game.tick,simulatedMinutes:game.tick/1200,elapsedMs:performance.now()-started,
  phases:phases.snapshot(),landPaths:game.paths.telemetry,waterPaths:game.waterPaths.telemetry,
  entities:{squads:game.squads.length,ships:game.ships.length,buildings:game.buildings.length,traders:game.expansion?.trade.actors.length},
  planner:game.routePlanner.diagnostics,memory:process.memoryUsage(),winner:game.winner,
  ...(args.includes("--inspect-churn")?{churn:structuredClone(churn),armyTimings:Object.fromEntries([...armyTimings].map(([key,timing])=>[key,timing.snapshot().tick])),armies:game.expansion?.armies.armies.map(a=>({id:a.id,playerId:a.playerId,members:a.memberIds.length,state:a.state})),cohorts:game.routePlanner.diagnosticCohorts(game.tick)}:{}),
  ...(publications?{publication:{published,encodedBytes,pending:publications.pending,skipped:publications.skipped,encoder:encodingWorker.timings,failure:publicationFailure?.message}}:{}),
  ages:game.expansion ? Object.values(game.expansion.progression.states).map(p=>p.age):[],
  ...(args.includes("--inspect-ai") && game.expansion ? {ai:game.players.filter(p=>p.ai&&p.kind!=="tribe").map(p=>({id:p.id,gold:p.gold,land:p.land,progression:game.expansion.progression.states[p.id],inventory:game.expansion.supply.inventories[p.id],buildings:game.buildingFacts().byOwner(p.id).reduce((counts,b)=>(counts[b.type]=(counts[b.type]??0)+1,counts),{}),traders:game.expansion.trade.actors.filter(a=>a.playerId===p.id).length,tradeGold:game.expansion.trade.deliveredGold[p.id]??0})),recovery:game.expansion.economy.recovery?.diagnostics,tradeDiagnostics:game.expansion.trade.diagnostics,economy:game.expansion.economy.checkpoint().saving,economicDiagnostics:game.expansion.economy.diagnostics}: {})});
const write = (name,data) => fs.writeFileSync(path.join(out,name),JSON.stringify(data));
fs.writeFileSync(path.join(out,"configuration.json"),JSON.stringify({settings,options,map:{width:map.width(),height:map.height()},experiment,filterStaleTransportCandidates:args.includes("--filter-stale-transport-candidates"),workerEncoding:!!encodingWorker,restore:restore??null,source:process.env.GIT_COMMIT??"local",node:process.version,architecture:process.arch}));
try {
  while(game.tick < total && game.winner === null) {
    if(!profiling && game.tick >= profileAt){await post("Profiler.enable");await post("Profiler.start");profiling=true;}
    game.step();
    if(navigationOrigin)for(const s of game.ships){let trip=shipTrips.get(s.id);if(!trip)shipTrips.set(s.id,trip={id:s.id,x:s.x,y:s.y,maximum:0,phases:new Set()});trip.maximum=Math.max(trip.maximum,Math.round(Math.hypot(s.x-trip.x,s.y-trip.y)));if(s.shoreTransfer)trip.phases.add(s.shoreTransfer.phase);}
    if (game.tick%4===0) {
      const capture=()=>phases.measure("snapshot",()=>encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts()));
      if(publications){publications.offer(game.tick,capture);await new Promise(resolve=>setImmediate(resolve));if(publicationFailure)throw publicationFailure;}
      else capture();
    }
    if(game.tick%600===0){
      const row=summary();fs.appendFileSync(path.join(out,"timeline.jsonl"),JSON.stringify(row)+"\n");
      console.log(JSON.stringify({tick:row.tick,elapsedMs:Math.round(row.elapsedMs),routingP95:row.phases.routing?.p95,tickP95:row.phases.tick?.p95,entities:row.entities}));
      await new Promise(resolve=>setImmediate(resolve));
    }
    if ([24000,38400,48000,60000,72000].includes(game.tick)) fs.writeFileSync(path.join(out,"checkpoint-"+game.tick+".v8"),serialize(game.checkpoint()));
    if(performance.now()-started > Number(value("--max-seconds","900"))*1000) {finished=true;break;}
  }
  if(publications)await publications.flush();
  fs.writeFileSync(path.join(out,"checkpoint-final.v8"),serialize(game.checkpoint()));
  write("summary.json",{...summary(),timeLimit:finished});
  if(navigationOrigin) write("navigation.json",navigation());
} catch(error) {
  fs.writeFileSync(path.join(out,"checkpoint-failure.v8"),serialize(game.checkpoint()));
  write("failure.json",{...summary(),error:{message:error.message,stack:error.stack}});
  throw error;
} finally {
  if(profiling){const result=await post("Profiler.stop");write("simulation.cpuprofile",result.profile);}
  session.disconnect();
  if(encodingWorker)await encodingWorker.close();
}
