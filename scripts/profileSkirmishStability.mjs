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

const args = process.argv.slice(2);
const value = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
const out = value("--out", "data/investigation-20261003/local-baseline");
fs.mkdirSync(out, { recursive: true });
const allAi = args.includes("--all-ai");
const settings = { ...defaultLobbySettings(value("--map", "valles-kairulia"), Number(value("--size", "500"))), aiCount:10, tribeCount:25 };
const loaded = await loadServerMap(settings);
const options = {seed:Number(value("--seed", "42")), aiCount:10, tribeCount:25, tribes:true, ruleset:"ages-v1", territoryIncomeScale:loaded.territoryIncomeScale, startingAge:value("--age", "StoneAge"),
  ...(allAi ? {aiEconomy:true,deferredPlanning:true,aiDefenses:true,aiNaval:true,aiWarPolicy:true}: {})};
const map = createSkirmishMap(loaded.map.width, loaded.map.height, loaded.map.terrain, loaded.map.elevation, loaded.map.forest, loaded.map.resourceTerrain);
const game = new Skirmish(map, options);
const restore = value("--restore");
if (restore) {
  const saved = restore.endsWith(".v8") ? deserialize(fs.readFileSync(restore)) : await decodeState(JSON.parse(fs.readFileSync(restore, "utf8")));
  if(allAi) Object.assign(saved.options, options);
  game.restore(saved);
}
const phases = new RuntimeDiagnostics(256, true);
game.onPhase = (phase, ms) => phases.record(phase, ms);
const encoder = new SnapshotEncoder(true);
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
  ages:game.expansion ? Object.values(game.expansion.progression.states).map(p=>p.age):[],
  ...(args.includes("--inspect-ai") && game.expansion ? {ai:game.players.filter(p=>p.ai&&p.kind!=="tribe").map(p=>({id:p.id,gold:p.gold,land:p.land,progression:game.expansion.progression.states[p.id],inventory:game.expansion.supply.inventories[p.id]})),economy:game.expansion.economy.checkpoint().saving,economicDiagnostics:game.expansion.economy.diagnostics}: {})});
const write = (name,data) => fs.writeFileSync(path.join(out,name),JSON.stringify(data));
fs.writeFileSync(path.join(out,"configuration.json"),JSON.stringify({settings,options,restore:restore??null,source:process.env.GIT_COMMIT??"local",node:process.version,architecture:process.arch}));
try {
  while(game.tick < total && game.winner === null) {
    if(!profiling && game.tick >= profileAt){await post("Profiler.enable");await post("Profiler.start");profiling=true;}
    game.step();
    if (game.tick%4===0) phases.measure("snapshot",()=>encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts()));
    if(game.tick%600===0){
      const row=summary();fs.appendFileSync(path.join(out,"timeline.jsonl"),JSON.stringify(row)+"\n");
      console.log(JSON.stringify({tick:row.tick,elapsedMs:Math.round(row.elapsedMs),routingP95:row.phases.routing?.p95,tickP95:row.phases.tick?.p95,entities:row.entities}));
      await new Promise(resolve=>setImmediate(resolve));
    }
    if (game.tick===24000 || game.tick===38400) fs.writeFileSync(path.join(out,"checkpoint-"+game.tick+".v8"),serialize(game.checkpoint()));
    if(performance.now()-started > Number(value("--max-seconds","900"))*1000) {finished=true;break;}
  }
  fs.writeFileSync(path.join(out,"checkpoint-final.v8"),serialize(game.checkpoint()));
  write("summary.json",{...summary(),timeLimit:finished});
} finally {
  if(profiling){const result=await post("Profiler.stop");write("simulation.cpuprofile",result.profile);}
  session.disconnect();
}
