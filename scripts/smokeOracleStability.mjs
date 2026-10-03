import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import WebSocket from "ws";
import { decodeState } from "../src/skirmish/multiplayer/StateCodec.ts";
import { SnapshotDecoder } from "../src/skirmish/SnapshotCodec.ts";
import { PlacementPreview } from "../src/skirmish/client/PlacementPreview.ts";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap.ts";
import { CoastIndex } from "../src/skirmish/CoastIndex.ts";
import { LandPaths, WaterPaths } from "../src/skirmish/Pathfinding.ts";
import { createSkirmishMap } from "../src/skirmish/Elevation.ts";
import { isLobbyMapId } from "../src/skirmish/lobby/LobbyRules.ts";

const args=process.argv.slice(2), arg=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const smokeSwitches=new Set(["--public","--water"]),smokeValues=new Set(["--url","--clients","--seconds","--age","--out","--map","--size"]);
for(let at=0;at<args.length;at++) {
  if(smokeSwitches.has(args[at]))continue;
  if(smokeValues.has(args[at]) && at+1<args.length){at++;continue;}
  throw new Error("Unknown or incomplete smoke option: "+args[at]);
}
const base=arg("--url","http://127.0.0.1:9010"), count=Number(arg("--clients","10")), seconds=Number(arg("--seconds","180"));
const mapId=arg("--map","valles-kairulia"), worldSize=Number(arg("--size","500"));
if(!isLobbyMapId(mapId)||![250,500,1000].includes(worldSize))throw new Error("Invalid smoke map or size");
if(!Number.isInteger(count)||count<2||count>20||!Number.isFinite(seconds)||seconds<10||seconds>2400)throw new Error("Invalid smoke limits");
if(!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)&&!args.includes("--public"))throw new Error("External smoke requires --public");
const out=arg("--out","data/oracle-smoke.json"), origin=new URL(base).origin, socketUrl=base.replace(/^http/,"ws")+"/socket";
const peers=[], checks=new Map(), failures=[], started=Date.now(), title="Stability smoke "+new Date().toISOString().replace(/[:.]/g,"-");
let matchId, roomId, request=0, completed=false;
let aiInitial; const aiMoved=new Set(), moves=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)), rid=()=> "smoke-"+(++request);
const wait=async(predicate,label,timeout=90000)=>{const at=Date.now();while(!predicate()){if(failures.length)throw new Error(failures[0]);if(Date.now()-at>timeout)throw new Error("Timed out: "+label);await sleep(50);}};
const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))]??0;
const send=(p,msg)=>p.ws.send(JSON.stringify(msg));
const connect=async(p,reconnect=false)=>{
  const playerId=p.manifest?.playerId;
  p.decoder=new SnapshotDecoder();p.directory=undefined;p.manifest=undefined;p.closed=false;p.chain=Promise.resolve();
  p.ws=new WebSocket(socketUrl,{origin});p.ws.on("error",e=>failures.push("Peer "+p.id+": "+e.message));
  p.ws.on("close",()=>p.closed=true);
  p.ws.on("message",raw=>{p.chain=p.chain.then(async()=>{
    const m=JSON.parse(raw.toString());
    if(m.type==="directory")p.directory=m;
    if(m.type==="error")failures.push("Peer "+p.id+" server: "+m.message);
    if(m.type==="ack")p.acks.set(m.requestId,m);
    if(m.type==="match"){p.manifest=m.manifest;matchId=m.manifest.id;send(p,{type:"match-ready",requestId:rid(),matchId,runtimeId:m.manifest.runtimeId,flowControl:true});}
    if(m.type==="match-command-outcome")p.outcomes.push(m.outcome);
    if(m.type==="match-ended")failures.push("Unexpected match ended: "+m.message);
    if(m.type!=="match-state")return;
    if(m.rebase)p.decoder=new SnapshotDecoder();
    const before=performance.now(), packet=await decodeState(m.packet), snapshot=p.decoder.decode(packet,false,false);
    if(p.id===0 && aiInitial) for(const s of snapshot.squads) {
      const start=aiInitial.get(s.id);
      if(start && Math.hypot(s.x-start.x,s.y-start.y)>=256) aiMoved.add(s.playerId);
    }
    p.decodeMs.push(performance.now()-before);p.bytes+=raw.length;p.packets++;p.snapshot=snapshot;
    if(p.lastAt)p.gaps.push(Date.now()-p.lastAt);p.lastAt=Date.now();p.tick=m.tick;
    if(m.syncId){p.syncs++;send(p,{type:"match-sync-applied",requestId:rid(),matchId:m.matchId,syncId:m.syncId,publicationSequence:m.publicationSequence});}
    else send(p,{type:"match-state-applied",requestId:rid(),matchId:m.matchId,publicationSequence:m.publicationSequence,flowEpoch:m.flowEpoch});
    if((m.publicationSequence??m.tick)%10===0){
      const hash=createHash("sha256").update(snapshot.owners).update(JSON.stringify([snapshot.squads,snapshot.ships,snapshot.buildings])).digest("hex");
      let row=checks.get(m.tick);if(!row)checks.set(m.tick,row=new Map());row.set(p.id,hash);
      if(new Set(row.values()).size>1)failures.push("Canonical state disagreement at tick "+m.tick);
      while(checks.size>300)checks.delete(checks.keys().next().value);
    }
  }).catch(e=>failures.push("Peer "+p.id+" decode: "+e.message));});
  await new Promise((resolve,reject)=>{p.ws.once("open",resolve);p.ws.once("error",reject);});
  send(p,{type:"authenticate",token:p.token,...(reconnect?{matchId}:{})});
  await wait(()=>p.directory,"authentication "+p.id);
  if(reconnect)send(p,{type:"watch-match",requestId:rid(),matchId,playerId});
};
try{
  const health=await (await fetch(base+"/healthz")).json();if(health.activeMatches!==0)throw new Error("Smoke requires an idle host; other matches were not touched");
  for(let i=0;i<count;i++){
    const res=await fetch(base+"/guest",{method:"POST",headers:{Origin:origin}});if(!res.ok)throw new Error("Guest HTTP "+res.status);
    const {token}=await res.json();const p={id:i,token,acks:new Map(),outcomes:[],decodeMs:[],gaps:[],bytes:0,packets:0,tick:0,syncs:0};
    peers.push(p);await connect(p);
  }
  const createId=rid();send(peers[0],{type:"create",requestId:createId,title,willingToWait:false,settings:{mapId,mode:"free-for-all",slots:count,minimumHumans:count,countdownSeconds:15,worldSize,aiCount:10,tribeCount:25,technologySpeed:1,startingAge:arg("--age","Modern"),resourceDensity:1,resourceOutput:1,alliances:true,victory:"solo",publicAiTakeover:false}});
  await wait(()=>peers[0].acks.has(createId),"create");roomId=peers[0].acks.get(createId).roomId;
  for(const p of peers.slice(1)){const id=rid();send(p,{type:"join",requestId:id,roomId});await wait(()=>p.acks.has(id),"join "+p.id);}
  await wait(()=>peers.every(p=>p.manifest&&p.tick>20),"all peers advancing",120000);
  const manifests=peers.map(p=>p.manifest);const flags=["aiEconomy","deferredPlanning","aiDefenses","aiNaval","aiWarPolicy"];
  if(manifests.some(m=>flags.some(f=>m.options[f]!==true)))throw new Error("AI policy defaults are not all enabled");
  if(new Set(manifests.map(m=>m.runtimeId+":"+m.mapHash)).size!==1)throw new Error("Manifest disagreement");
  console.log(JSON.stringify({stage:"advancing",matchId,peers:count,tick:peers[0].tick,flags:Object.fromEntries(flags.map(f=>[f,true]))}));
  const aiIds=peers[0].snapshot.players.filter(p=>p.ai&&p.kind==="regular").map(p=>p.id);
  aiInitial=new Map(peers[0].snapshot.squads.filter(s=>aiIds.includes(s.playerId)).map(s=>[s.id,{x:s.x,y:s.y}]));
  for(const peer of peers) {
    const units=peer.snapshot.squads.filter(s=>s.playerId===peer.manifest.playerId&&s.embarkedOn===null);
    if(!units.length)throw new Error("No initial player squads");
    const starts=new Map(units.map(s=>[s.id,{x:s.x,y:s.y}])), width=peer.snapshot.width;
    const goals=[];
    for(let tile=0;tile<peer.snapshot.owners.length;tile++) {
      if(peer.snapshot.owners[tile]!==peer.manifest.playerId)continue;
      const x=(tile%width+.5)*256,y=(Math.floor(tile/width)+.5)*256;
      const distance=Math.hypot(x-units[0].x,y-units[0].y);
      if(distance>=4*256&&distance<=8*256)goals.push({tile,distance});
    }
    goals.sort((a,b)=>a.distance-b.distance||a.tile-b.tile);
    if(!goals.length)throw new Error("No owned movement destination");
    const id=rid(), tile=goals[0].tile, commandTick=peer.tick;
    send(peer,{type:"match-command",requestId:id,matchId,command:{type:"order",playerId:peer.manifest.playerId,squadIds:units.map(s=>s.id),order:{type:"move",tile}}});
    await wait(()=>peer.outcomes.some(o=>o.id===id&&["executed","rejected","superseded"].includes(o.status)),"movement receipt "+peer.id,15000);
    const outcome=peer.outcomes.find(o=>o.id===id&&["executed","rejected","superseded"].includes(o.status));
    if(outcome.status!=="executed")throw new Error("Player move failed: "+JSON.stringify(outcome));
    await wait(()=>units.every(s=>{const live=peer.snapshot.squads.find(u=>u.id===s.id),start=starts.get(s.id);return live&&Math.hypot(live.x-start.x,live.y-start.y)>=64;}),"physical player movement "+peer.id,15000);
    moves.push({playerId:peer.manifest.playerId,commandTick,observedTick:peer.tick,tile,squadIds:units.map(s=>s.id),outcome});
  }
  console.log(JSON.stringify({stage:"movement",moves}));
  // Exercise an affordable, already-unlocked building through the normal command
  // path, and require the new authoritative building to finish construction.
  const p=peers[0], loaded=await loadServerMap(p.manifest.settings), terrain=loaded.map;
  const map=createSkirmishMap(terrain.width,terrain.height,terrain.terrain,terrain.elevation,terrain.forest,terrain.resourceTerrain);
  const preview=new PlacementPreview(map), age=p.snapshot.expansion.progression[p.manifest.playerId].age;
  preview.begin(p.snapshot,p.manifest.playerId,"barracks",age);
  const buildTile=p.snapshot.owners.findIndex((owner,tile)=>owner===p.manifest.playerId && preview.rejection("barracks",tile)===null);
  if(buildTile<0)throw new Error("No affordable valid barracks site");
  const existingBuildings=new Set(p.snapshot.buildings.map(b=>b.id)), buildId=rid(), buildTick=p.tick;
  send(p,{type:"match-command",requestId:buildId,matchId,command:{type:"build",playerId:p.manifest.playerId,buildingType:"barracks",age,tile:buildTile}});
  await wait(()=>p.outcomes.some(o=>o.id===buildId&&["executed","rejected","superseded"].includes(o.status)),"valid build receipt",15000);
  const buildOutcome=p.outcomes.find(o=>o.id===buildId&&["executed","rejected","superseded"].includes(o.status));
  if(buildOutcome.status!=="executed")throw new Error("Valid build failed: "+JSON.stringify(buildOutcome));
  let built;
  await wait(()=>{built=p.snapshot.buildings.find(b=>!existingBuildings.has(b.id)&&b.playerId===p.manifest.playerId&&b.type==="barracks"&&b.tile===buildTile);return built?.remainingTicks===0;},"completed authoritative building",15000);
  const validBuild={commandTick:buildTick,completedTick:p.tick,buildingId:built.id,tile:buildTile,age,outcome:buildOutcome};
  console.log(JSON.stringify({stage:"construction",validBuild}));
  let waterTransport;
  if(args.includes("--water")) {
    const land=new LandPaths(map,false),water=new WaterPaths(map,false),coast=new CoastIndex(map,land,water);
    const squad=p.snapshot.squads.find(s=>s.playerId===p.manifest.playerId&&s.embarkedOn===null);
    if(!squad)throw new Error("No available embarkation squad");
    const originTile=map.ref(Math.floor(squad.x/256),Math.floor(squad.y/256));
    const shores=coast.connections().filter(c=>c.landComponent===land.component[originTile]).flatMap(c=>c.edges);
    shores.sort((a,b)=>map.manhattanDist(originTile,a.landTile)-map.manhattanDist(originTile,b.landTile)||a.landTile-b.landTile);
    if(!shores.length)throw new Error("No same-land coast");
    // The nearest shore may border a tiny enclosed pond. Choose an actual nearby
    // sailing passage rather than treating that fixture limitation as a game failure.
    const waterSizes=new Map();
    for(let tile=0;tile<map.width()*map.height();tile++)if(water.walkable(tile)){const c=water.component[tile];waterSizes.set(c,(waterSizes.get(c)??0)+1);}
    let edge,goal;
    for(const candidate of shores){
      if((waterSizes.get(water.component[candidate.waterTile])??0)<16)continue;
      for(let radius=5;radius<=7&&goal===undefined;radius++)for(let dy=-radius;dy<=radius&&goal===undefined;dy++)for(let dx=-radius;dx<=radius;dx++) {
        if(Math.abs(dx)+Math.abs(dy)!==radius)continue;
        const x=map.x(candidate.waterTile)+dx,y=map.y(candidate.waterTile)+dy;if(!map.isValidCoord(x,y))continue;
        const tile=map.ref(x,y);if(water.walkable(tile)&&water.component[tile]===water.component[candidate.waterTile]){const path=water.find(candidate.waterTile,tile);if(path && path.length<=12){edge=candidate;goal=tile;break;}}
      }
      if(goal!==undefined)break;
    }
    if(goal===undefined)throw new Error("No nearby water destination");
    const id=rid(),commandTick=p.tick;
    send(p,{type:"match-command",requestId:id,matchId,command:{type:"order",playerId:p.manifest.playerId,squadIds:[squad.id],order:{type:"move",tile:goal}}});
    await wait(()=>p.outcomes.some(o=>o.id===id&&["executed","rejected","superseded"].includes(o.status)),"water embarkation receipt",30000);
    const outcome=p.outcomes.find(o=>o.id===id&&["executed","rejected","superseded"].includes(o.status));if(outcome.status!=="executed")throw new Error("Water move failed: "+JSON.stringify(outcome));
    let boat;
    await wait(()=>{const live=p.snapshot.squads.find(s=>s.id===squad.id);boat=live&&p.snapshot.ships.find(s=>s.id===live.embarkedOn);return boat?.shoreTransfer?.phase==="afloat" && Math.floor(boat.x/256)+Math.floor(boat.y/256)*map.width()===goal;},"physical water arrival",120000);
    const boatId=boat.id,afloatTick=p.tick;
    const invalidUnloadId=rid();
    send(p,{type:"match-command",requestId:invalidUnloadId,matchId,command:{type:"unload",playerId:p.manifest.playerId,shipId:boatId,tile:goal}});
    await wait(()=>p.outcomes.some(o=>o.id===invalidUnloadId&&o.status==="rejected"),"invalid water landing rejection");
    const invalidUnload=p.outcomes.find(o=>o.id===invalidUnloadId&&o.status==="rejected");
    if(invalidUnload.reason!=="Choose passable coastal land directly beside the transport")throw new Error("Unexpected water landing rejection: "+JSON.stringify(invalidUnload));
    if(p.snapshot.squads.find(s=>s.id===squad.id)?.embarkedOn!==boatId)throw new Error("Invalid landing lost cargo");
    send(p,{type:"match-command",requestId:rid(),matchId,command:{type:"sail",playerId:p.manifest.playerId,shipIds:[boatId],tile:edge.waterTile}});
    await wait(()=>{const b=p.snapshot.ships.find(s=>s.id===boatId);return b&&b.destination===null&&Math.floor(b.x/256)+Math.floor(b.y/256)*map.width()===edge.waterTile;},"manual afloat return",30000);
    const unloadId=rid();send(p,{type:"match-command",requestId:unloadId,matchId,command:{type:"unload",playerId:p.manifest.playerId,shipId:boatId,tile:edge.landTile}});
    await wait(()=>p.snapshot.squads.find(s=>s.id===squad.id)?.embarkedOn===null&&!p.snapshot.ships.some(s=>s.id===boatId),"physical manual landing",30000);
    waterTransport={squadId:squad.id,boatId,commandTick,afloatTick,landedTick:p.tick,destination:goal,landing:edge.landTile,outcome,invalidUnload};
    console.log(JSON.stringify({stage:"water-transport",waterTransport}));
  }
  const invalidId=rid();let badTile=p.snapshot.owners.findIndex(owner=>owner!==p.manifest.playerId);
  send(p,{type:"match-command",requestId:invalidId,matchId,command:{type:"build",playerId:p.manifest.playerId,buildingType:"city",tile:badTile}});
  await wait(()=>p.outcomes.some(o=>o.id===invalidId&&o.status==="rejected"),"invalid build rejection");
  const rejection=p.outcomes.find(o=>o.id===invalidId&&o.status==="rejected");
  const until=Date.now()+seconds*1000;let reconnected=false,nextReport=Date.now()+30000;
  while(Date.now()<until){
    if(failures.length)throw new Error(failures[0]);
    if(!reconnected&&Date.now()>until-seconds*500){p.ws.close();await wait(()=>p.closed,"close reconnect socket");await connect(p,true);await wait(()=>p.manifest&&p.tick>20,"reconnected state");reconnected=true;}
    if(Date.now()>=nextReport){console.log(JSON.stringify({stage:"monitor",matchId,ticks:peers.map(p=>p.tick),elapsedSeconds:Math.round((Date.now()-started)/1000)}));nextReport=Date.now()+30000;}
    await sleep(100);
  }
  if(aiIds.some(id=>!aiMoved.has(id)))throw new Error("Regular AI failed to displace: "+aiIds.filter(id=>!aiMoved.has(id)).join(","));
  const common=[...checks].filter(([,row])=>row.size===count);
  if(common.length<5)throw new Error("Too few common tick agreement samples");
  if(peers.some(p=>Boolean(p.closed)||Boolean(p.packets<10)||Boolean(Date.now()-p.lastAt>10000)))throw new Error("A peer stopped advancing");
  const result={passed:true,title,matchId,roomId,base,mapId,worldSize,clients:count,seconds,elapsedSeconds:(Date.now()-started)/1000,flags:Object.fromEntries(flags.map(f=>[f,true])),runtimeId:manifests[0].runtimeId,mapHash:manifests[0].mapHash,moves,validBuild,waterTransport,aiMoved:[...aiMoved].sort((a,b)=>a-b),rejection,reconnected,commonStateSamples:common.length,peers:peers.map(p=>({id:p.id,tick:p.tick,packets:p.packets,syncs:p.syncs,bytes:p.bytes,decodeP95:percentile(p.decodeMs,.95),publicationGapP95:percentile(p.gaps,.95),publicationGapMax:Math.max(...p.gaps)})),failures};
  fs.mkdirSync(path.dirname(out),{recursive:true});
  completed=true;fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
} finally {
  for(const p of peers)p.ws?.close();
  if(!completed){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({passed:false,matchId,failures,peers:peers.map(p=>({tick:p.tick,playerId:p.manifest?.playerId,outcomes:p.outcomes,squads:p.snapshot?.squads.filter(s=>s.playerId===p.manifest?.playerId),ships:p.snapshot?.ships.filter(s=>s.playerId===p.manifest?.playerId)}))},null,2));process.exitCode=1;}
}
