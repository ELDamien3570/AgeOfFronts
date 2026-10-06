/** Paired local pipeline measurements against the frozen source tree.
 * This isolates projection/transport overhead; it is not a match FPS claim. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED, type SnapshotPacket } from "../../src/skirmish/Protocol";
import { SnapshotEncoder, SnapshotDecoder, snapshotTransfers } from "../../src/skirmish/SnapshotCodec";
import { CanonicalStateStream } from "../../src/skirmish/client/CanonicalStateStream";
import { encodeState, decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { encodeSnapshotFrame, decodeSnapshotFrame } from "../../src/skirmish/multiplayer/SnapshotWireCodec";
import { SNAPSHOT_STATE_LIMITS } from "../../src/skirmish/multiplayer/StateLimits";

const baseline = await import(pathToFileURL(resolve("out/architecture-baseline/src/skirmish/client/CanonicalStateStream.ts")).href);
const oldCodec = await import(pathToFileURL(resolve("out/architecture-baseline/src/skirmish/multiplayer/StateCodec.ts")).href);
const width=1024,height=768,size=width*height,game=new Skirmish(new GameMapImpl(width,height,new Uint8Array(size).fill(133),size),
  {seed:42,aiCount:14,runAi:false,tribes:false,ruleset:"ages-v1"});
const template=game.squads[0];for(const squad of game.squads)game.removeSquad(squad.id);
for(let at=0;at<1500;at++)game.addSquad({...template,id:game.allocateId(),playerId:1+Math.floor(at/100),
  x:(30+at%40*2)*FIXED,y:(24+Math.floor(at/40)*2)*FIXED,order:{type:"hold"},path:[],queuedOrders:[]});
for(let at=0;at<300;at++)game.addBuilding({id:game.allocateId(),playerId:1,type:"tower",tile:2000+at,remainingTicks:0,health:2000,maxHealth:2000});
const packet=new SnapshotEncoder(true).encode(game.snapshot()),before=new baseline.CanonicalStateStream(size),after=new CanonicalStateStream(size),rendererDecoder=new SnapshotDecoder();
before.apply(packet);after.apply(packet);
const baseView=after.presentationPacket();rendererDecoder.decode(baseView.viewPacket,false);after.acknowledge(baseView.canonicalSequence);before.acknowledge(1);
const summary=(values:number[])=>{const sorted=values.slice().sort((a,b)=>a-b);return{mean:values.reduce((a,b)=>a+b,0)/values.length,p95:sorted[Math.ceil(values.length*.95)-1],samples:values.length};};
const oldProjection:number[]=[],newProjection:number[]=[],oldComplete:number[]=[],newComplete:number[]=[];
let viewBytes=0;
for(let at=0;at<65;at++){
  const delta={...packet,tick:at+1,reset:false,tiles:new Uint32Array([100,at%2+1]),expansion:{...packet.expansion,roads:undefined,deposits:undefined}};
  before.apply(delta);after.apply(delta);
  const legacy=()=>{const start=performance.now(),view=before.presentationForTransfer(),projected=performance.now();
    const received=structuredClone(view,{transfer:[view.snapshot.owners.buffer,view.snapshot.claims.buffer,view.snapshot.progress.buffer]});
    before.acknowledge(view.canonicalSequence);return{snapshot:received.snapshot,projection:projected-start,complete:performance.now()-start};};
  const packed=()=>{const start=performance.now(),view=after.presentationPacket(),projected=performance.now();
    const buffers=snapshotTransfers(view.viewPacket);viewBytes=buffers.reduce((sum,buffer)=>sum+buffer.byteLength,0);
    const received=structuredClone(view,{transfer:buffers}),snapshot=rendererDecoder.decode(received.viewPacket,false);
    after.acknowledge(view.canonicalSequence);return{snapshot,projection:projected-start,complete:performance.now()-start};};
  // Alternate execution order to reduce warm-cache bias.
  const [oldView,newView]=at%2===0?[legacy(),packed()]:(()=>{const next=packed();return[legacy(),next];})();
  if(!isDeepStrictEqual(oldView.snapshot.owners,newView.snapshot.owners)||!isDeepStrictEqual(oldView.snapshot.squads,newView.snapshot.squads)||!isDeepStrictEqual(oldView.snapshot.buildings,newView.snapshot.buildings))throw new Error("Presentation mismatch");
  if(at>=5){oldProjection.push(oldView.projection);newProjection.push(newView.projection);oldComplete.push(oldView.complete);newComplete.push(newView.complete);}
}
const oldEncode:number[]=[],newEncode:number[]=[],oldDecode:number[]=[],newDecode:number[]=[],oldSend:number[]=[],newSend:number[]=[];
let textBytes=0,binaryBytes=0;
for(let at=0;at<25;at++){
  const text=async()=>{let start=performance.now();const encoded=await oldCodec.encodeState(packet,undefined,SNAPSHOT_STATE_LIMITS),encodedAt=performance.now();
    const message={type:"match-state",matchId:"pipeline",packet:encoded,tick:0,paused:false,disconnectedPlayerIds:[],executor:"server"};
    const wire=JSON.stringify(message),sentAt=performance.now();textBytes=Buffer.byteLength(wire);
    const decoded=await oldCodec.decodeState(JSON.parse(wire).packet,SNAPSHOT_STATE_LIMITS);if(!isDeepStrictEqual(decoded,packet))throw new Error("Text mismatch");
    return[encodedAt-start,sentAt-encodedAt,performance.now()-sentAt];};
  const binary=async()=>{let start=performance.now();const encoded=await encodeState(packet,undefined,SNAPSHOT_STATE_LIMITS,true),encodedAt=performance.now();
    const wire=encodeSnapshotFrame({type:"match-state",matchId:"pipeline",packet:encoded,tick:0,paused:false,disconnectedPlayerIds:[],executor:"server"}),sentAt=performance.now();binaryBytes=wire.byteLength;
    const decoded=await decodeState<SnapshotPacket>(decodeSnapshotFrame(wire.buffer).packet,SNAPSHOT_STATE_LIMITS);if(!isDeepStrictEqual(decoded,packet))throw new Error("Binary mismatch");
    return[encodedAt-start,sentAt-encodedAt,performance.now()-sentAt];};
  let old:number[],next:number[];if(at%2===0){old=await text();next=await binary();}else{next=await binary();old=await text();}
  if(at>=5){oldEncode.push(old[0]);oldSend.push(old[1]);oldDecode.push(old[2]);newEncode.push(next[0]);newSend.push(next[1]);newDecode.push(next[2]);}
}
const evidence={baseline:"234d62a74ac32275c1d99cb693bec97110347a05",runtime:process.version,scene:{width,height,squads:1500,buildings:game.buildings.length},
  projection:{before:summary(oldProjection),after:summary(newProjection),completeBefore:summary(oldComplete),completeAfter:summary(newComplete),
    priorMapCopyBytesPerView:size*3,packedMapBytesPerView:8,totalPackedTransferBytes:viewBytes},
  network:{textBytes,binaryBytes,encodeBefore:summary(oldEncode),encodeAfter:summary(newEncode),framingBefore:summary(oldSend),framingAfter:summary(newSend),decodeBefore:summary(oldDecode),decodeAfter:summary(newDecode)},
  limitation:"Local Node microbenchmark: projection plus structured-clone and main-thread decoding, and codec/framing. No renderer, actual sockets, network RTT or full-match FPS in these timings."};
writeFileSync(resolve(process.argv[2]??"out/architecture-baseline/pipeline.json"),JSON.stringify(evidence,null,2)+"\n");console.log(JSON.stringify(evidence));
