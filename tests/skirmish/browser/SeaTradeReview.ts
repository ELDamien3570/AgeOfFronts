import { decodeState } from "../../../src/skirmish/multiplayer/StateCodec";
import { defaultLobbySettings } from "../../../src/skirmish/lobby/LobbyDirectory";
import type { ExecutorRequest, MatchAdvance, ClientBaseline, JoinBarrier } from "../../../src/skirmish/multiplayer/application/MatchExecutor";
import type { SnapshotPacket } from "../../../src/skirmish/Protocol";
import { seaFleet } from "../SeaTradeFixture";
import { Renderer } from "../../../src/skirmish/client/Renderer";
import { EmpireView, empireMarkup } from "../../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../../src/skirmish/client/HudView";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { SnapshotEncoder, SnapshotDecoder } from "../../../src/skirmish/SnapshotCodec";
const fixture=seaFleet(); let game=fixture.game, borrowed=false, reconnects=0, agreement=true; let workerSmoke:unknown;
const root=document.querySelector<HTMLElement>("#app")!;
root.innerHTML=`${empireMarkup()}<main class="battlefield"><div id="scene"><canvas id="battlefield" aria-label="Sea trade renderer"></canvas></div>${hudMarkup()}</main>`;
const renderer=new Renderer(root.querySelector<HTMLCanvasElement>("#battlefield")!);
renderer.setMap(game.map);
const view=new EmpireView(root,{refresh(){publish();},command(command){game.applyCommand(command);publish();},build(){},notify(){},focusedRef:()=>null,target(){}});
let encoder=new SnapshotEncoder(true,{compactTraders:true}),decoder=new SnapshotDecoder();
function publish(){
 const snapshot=borrowed?decoder.decode(encoder.encode(game.replicationSource(true),game.tileChanges,game.replicationFacts())):game.snapshot();
 renderer.update(snapshot);
 view.update(new EmpireViewModel(snapshot,{selected:new Set(),selectedShips:new Set(),selectedBuilding:null}));
 document.querySelector("#status")!.textContent=JSON.stringify({workerSmoke,tick:game.tick,publication:borrowed?"borrowed":"full",reconnects,agreement,gold:game.expansion!.trade.deliveredGold[1],cycles:game.expansion!.trade.seaTrade!.diagnostics.cycles,actors:snapshot.expansion!.traders.map(actor=>({id:actor.id,owner:actor.playerId,state:actor.state,cargo:actor.cargo,wait:actor.waitingReason,detail:actor.waitDetail}))},null,2);
}
function step(count:number){for(let i=0;i<count;i++)game.step();publish();}
document.querySelector("#advance")!.addEventListener("click",()=>step(80));
document.querySelector("#cycle")!.addEventListener("click",()=>step(600));
document.querySelector("#publication")!.addEventListener("click",()=>{borrowed=!borrowed;encoder=new SnapshotEncoder(true,{compactTraders:true});decoder=new SnapshotDecoder();publish();});
document.querySelector("#reconnect")!.addEventListener("click",()=>{
 const saved=game.checkpoint(),cold=new Skirmish(fixture.map(),fixture.options);cold.restore(saved);
 for(let i=0;i<8;i++){game.step();cold.step();}
 agreement=JSON.stringify(game.checkpoint())===JSON.stringify(cold.checkpoint());
 if(!agreement)throw Error("Reconnect state diverged");game=cold;reconnects++;
 encoder=new SnapshotEncoder(true,{compactTraders:true});decoder=new SnapshotDecoder();publish();
});
document.querySelector("#capture")!.addEventListener("click",()=>{
 const actor=game.expansion!.trade.actors.find(actor=>actor.naval&&actor.playerId===1&&actor.cargo>0);
 if(!actor){step(80);return;}
 game.addShip({id:game.allocateId(),playerId:2,kind:"warship",definitionId:"stoneage-warship",x:actor.x,y:actor.y,health:1000,destination:null,waypoints:[],path:[],nextPathIndex:0,fighting:false});step(1);
});
document.querySelector("#intake")!.addEventListener("click",()=>{
 const actor=game.expansion!.trade.actors.find(actor=>actor.playerId===1);if(actor)game.expansion!.trade.seaTrade!.setWait(actor,"market-intake");publish();if(root.querySelector<HTMLElement>("#empire-panel")!.hidden)view.toggle("supplies");
});
publish();renderer.home();view.toggle("supplies");
requestAnimationFrame(function frame(now){renderer.draw(now,1,true);requestAnimationFrame(frame);});

function snapshotDifference(a:unknown,b:unknown,path="snapshot"):string|undefined {
 if(Object.is(a,b))return;
 if(typeof a!=="object"||typeof b!=="object"||a===null||b===null)return `${path}: ${String(a)} versus ${String(b)}`;
 if(Array.isArray(a)!==Array.isArray(b))return `${path}: array shape differs`;
 for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
  if(path==="snapshot"&&key==="changedTiles")continue; // Delivery metadata; compare reconstructed tile state instead.
  const difference=snapshotDifference((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key],`${path}.${key}`);
  if(difference)return difference;
 }
 return;
}
document.querySelector<HTMLButtonElement>("#host-worker")!.addEventListener("click",async event=>{
 const button=event.currentTarget as HTMLButtonElement; button.disabled=true;
 const worker=new Worker(new URL("../../../src/skirmish/client/hostMatchWorker.ts",import.meta.url),{type:"module"});
 let nextId=0;
 const request=<T>(request:ExecutorRequest)=>new Promise<T>((resolve,reject)=>{
  const id=++nextId,timer=setTimeout(()=>reject(Error("Host worker timed out")),30000);
  worker.onerror=error=>{clearTimeout(timer);reject(Error(error.message));};
  worker.onmessage=event=>{if(event.data.id!==id)return;clearTimeout(timer);if(event.data.error)reject(Error(event.data.error));else resolve(event.data.result);};
  worker.postMessage({id,request});
 });
 try {
  const map=fixture.map(),terrain=new Uint8Array(map.width()*map.height()).fill(133);
  for(let y=40;y<50;y++)terrain.fill(0,y*map.width(),(y+1)*map.width());
  const initial=await request<MatchAdvance>({type:"initialize",settings:defaultLobbySettings("migration",250),options:fixture.options,map:{width:map.width(),height:map.height(),terrain}});
  const decoder=new SnapshotDecoder();decoder.decode(await decodeState<SnapshotPacket>(initial.packet!));
  let latest;
  for(let i=0;i<25;i++){
   const advance=await request<MatchAdvance>({type:"advance",ticks:4,commands:[],disconnectedPlayerIds:[],publish:true});
   latest=decoder.decode(await decodeState<SnapshotPacket>(advance.packet!));
  }
  const joined=await request<JoinBarrier>({type:"join-barrier",playerId:2});
  const aligned=decoder.decode(await decodeState<SnapshotPacket>(joined.packet));
  const joinedBaseline=new SnapshotDecoder().decode(await decodeState<SnapshotPacket>(joined.baseline));
  const joinDifference=snapshotDifference(aligned,joinedBaseline);if(joinDifference)throw Error(`Host join baseline disagreed: ${joinDifference}`);
  const fresh=await request<ClientBaseline>({type:"client-baseline"});
  const restored=new SnapshotDecoder().decode(await decodeState<SnapshotPacket>(fresh.baseline));
  const clientDifference=snapshotDifference(aligned,restored);if(clientDifference)throw Error(`Host client baseline disagreed: ${clientDifference}`);
  workerSmoke={passed:true,worker:"production hostMatchWorker.ts",policy:fixture.options.seaTradeRouting,tick:latest!.tick,joinAndClientBaselineAgree:true,limitation:"Host worker initialization/advance/join smoke; sea voyage/capture fixture runs in the page."};
 }catch(error){workerSmoke={passed:false,error:String(error)};}
 finally{worker.terminate();button.disabled=false;publish();}
});
