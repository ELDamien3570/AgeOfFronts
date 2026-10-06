import { writeFileSync } from "node:fs";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import { FIXED } from "../../src/skirmish/Protocol";
import { squadCap } from "../../src/skirmish/FactionRules";
import { SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { encodeState } from "../../src/skirmish/multiplayer/StateCodec";
const label = process.argv[2] ?? "local", regulars = Number(process.argv[3] ?? 16), ticks = Number(process.argv[4] ?? 600);
const warmup = Number(process.argv[5] ?? 100);
if(!Number.isSafeInteger(regulars)||regulars<15||!Number.isSafeInteger(ticks)||ticks<1||
  !Number.isSafeInteger(warmup)||warmup<0||warmup>=ticks)throw new Error("Invalid profile faction count, tick count or warm-up");
const width=1000,height=660,data=new Uint8Array(width*height).fill(133);
data.fill(0,400*width,640*width);
const game=new Skirmish(new GameMapImpl(width,height,data,data.length),{
 seed:72,humanNames:Array.from({length:regulars-14},(_,i)=>`Human ${i+1}`), aiCount:14,tribes:true,tribeCount:30,
 ruleset:"ages-v1",startingAge:"Modern",alliances:true,...DEFAULT_AI_POLICIES});
const regular=game.players.filter(p=>p.kind!=="tribe");
if(regular.length!==regulars)throw new Error("Profile faction count does not match the constructed match");
for(const [at,p] of regular.entries()){
 const template=structuredClone(game.squadFacts().byOwner(p.id)[0]);
 const current=game.squadFacts().byOwner(p.id).length;
 for(let i=current;i<squadCap(p,"Modern");i++) game.addSquad({...template,id:game.allocateId(),x:template.x+(i%10)*FIXED*2,y:template.y+Math.floor(i/10)*FIXED*2,order:{type:"hold"},path:[],queuedOrders:[]});
 const x=10+at*28;
 const port=game.addBuilding({id:game.allocateId(),playerId:p.id,type:"port",tile:game.map.ref(x,398),remainingTicks:0,health:1000,age:"Modern"});
 for(let y=398;y<400;y++) for(let dx=0;dx<2;dx++)
   (game as unknown as {changeOwner(tile:number,id:number):void}).changeOwner(game.map.ref(x+dx,y),p.id);
 game.expansion!.supply.goods.set(port.id,100000);
 for(let i=0;i<64;i++)game.addShip({id:game.allocateId(),playerId:p.id,kind:"warship",definitionId:"modern-warship",x:(10+i*15+at%2+.5)*FIXED,y:(430+at*4+.5)*FIXED,health:game.expansion!.vessel({playerId:p.id,definitionId:"modern-warship",kind:"warship"} as never).health,destination:null,waypoints:[],path:[],nextPathIndex:0,fighting:false,boarding:null});
 if(at>0)game.applyCommand({type:"alliance",playerId:1,otherId:p.id,action:"declare"});
}
const phases:Record<string,number[]>={};
game.onPhase=(phase,ms)=>{if(game.tick>warmup)(phases[phase]??=[]).push(ms);};
const encoder=new SnapshotEncoder(),samples:number[]=[],encoding:number[]=[],packets:number[]=[];
let above50=0,peakRss=0,peakHeap=0;
encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts());
for(let i=0;i<ticks;i++){
 const start=performance.now();game.step();const elapsed=performance.now()-start;
 if(i>=warmup){samples.push(elapsed);if(elapsed>50)above50++;}
 if(i%4===0){const start=performance.now(),packet=encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts()),wire=await encodeState(packet);encoding.push(performance.now()-start);packets.push(Math.floor(wire.payload.length*3/4));}
 const memory=process.memoryUsage();peakRss=Math.max(peakRss,memory.rss);peakHeap=Math.max(peakHeap,memory.heapUsed);
}
function stats(values:number[]){values.sort((a,b)=>a-b);return {mean:values.reduce((a,b)=>a+b,0)/values.length,p95:values[Math.ceil(values.length*.95)-1],p99:values[Math.ceil(values.length*.99)-1],max:values[values.length-1]};}
const result={phases:Object.fromEntries(Object.entries(phases).map(([phase,values])=>[phase,stats(values)])),label,regulars,tribes:30,ticks:game.tick,warmup,squads:game.squads.length,ships:game.ships.length,traders:game.expansion!.trade.actors.length,combatTicks:game.combatTicks,simulation:stats(samples),encoding:stats(encoding),compressedPacketBytes:stats(packets),above50,peakRss,peakHeap};
writeFileSync(`out/release-profile-${label}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if(result.simulation.p95>=50 || result.simulation.mean+result.encoding.mean/4>=50)process.exitCode=1;
