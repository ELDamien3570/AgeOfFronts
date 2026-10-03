import fs from "node:fs";
import path from "node:path";
import { GameMapImpl } from "../src/core/game/GameMap.ts";
import { Skirmish } from "../src/skirmish/Simulation.ts";
import { FIXED } from "../src/skirmish/Protocol.ts";

const args=process.argv.slice(2), value=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const out=value("--out","out/v1.1-investigation/movement-baseline.json");
const ticks=Number(value("--ticks","2400"));
const results=[];
function fixture(kind,count) {
  const width=96,height=64,data=new Uint8Array(width*height).fill(133);
  if(kind.startsWith("transport")) {
    for(let y=0;y<height;y++)for(let x=30;x<(kind==="transport-island"?width:33);x++)data[y*width+x]=0;
    if(kind==="transport-island")for(let y=25;y<27;y++)for(let x=75;x<77;x++)data[y*width+x]=133;
  }
  if(kind.endsWith("gap")) {
    for(let y=0;y<height;y++)for(let x=45;x<=49;x++)if(y!==31)data[y*width+x]=0;
  }
  const map=new GameMapImpl(width,height,data,data.filter(t=>t&128).length);
  const game=new Skirmish(map,{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1",deferredPlanning:true,aiWarPolicy:true});
  const template=structuredClone(game.squads.find(s=>s.playerId===1));
  for(const s of [...game.squads])game.removeSquad(s.id);
  game.addSquad({...structuredClone(template),id:game.allocateId(),playerId:2,x:5.5*FIXED,y:5.5*FIXED,troops:1000000,order:{type:"hold"},path:[],queuedOrders:[],embarkedOn:null});
  game.owners.fill(1);
  if(kind.startsWith("transport"))for(let y=0;y<height;y++)for(let x=33;x<width;x++)if(data[y*width+x]&128)game.owners[y*width+x]=2;
  game.expansion.progression.states[1].completed.push("stoneage-cargo-canoes");
  const selected=Array.from({length:count},(_,i)=>game.addSquad({...structuredClone(template),id:game.allocateId(),x:(15.5+i%10)*FIXED,y:(25.5+Math.floor(i/10))*FIXED,order:{type:"hold"},path:[],queuedOrders:[],embarkedOn:null}));
  let blocker;
  if(kind.endsWith("gap"))blocker=game.addSquad({...structuredClone(template),id:game.allocateId(),playerId:kind==="enemy-gap"?2:1,x:48.5*FIXED,y:31.5*FIXED,troops:1000000,nextAttackTick:100000,order:{type:"hold"},path:[],queuedOrders:[]});
  const destination=map.ref(75,kind==="transport-island"?25:31);
  return {game,selected,destination,blocker};
}
for(const [kind,count] of [["open",20],["open",100],["friendly-gap",40],["enemy-gap",20],["transport-river",20],["transport-river",100],["transport-island",50]]) {
  const {game,selected,destination,blocker}=fixture(kind,count);
  const origins=new Map(selected.map(s=>[s.id,{x:s.x,y:s.y}]));
  const command={type:"order",playerId:1,squadIds:selected.map(s=>s.id),order:{type:"move",tile:destination}};
  const start=performance.now(),timings=[],routing=[],movement=[];
  game.onPhase=(phase,ms)=>{if(phase==="tick")timings.push(ms);if(phase==="routing")routing.push(ms);if(phase==="movement")movement.push(ms);};
  const initial=game.commandApplications.apply("v11-profile",command);
  let firstOrderTick,firstMotionTick,allOrdersTick,arrivalTick,boats=0,enemyBreach=false;
  const admitted=new Set(), launched=new Set();
  const arrived=s=>game.squad(s.id)&&s.embarkedOn===null&&s.order.type==="hold"&&
    Math.hypot(s.x-(game.map.x(destination)+.5)*FIXED,s.y-(game.map.y(destination)+.5)*FIXED)<18*FIXED;
  for(let i=0;i<ticks;i++) {
    game.step();boats=Math.max(boats,game.ships.length);
    for(const ship of game.ships)launched.add(ship.id);
    for(const squad of selected)if(squad.order.type!=="hold")admitted.add(squad.id);
    if(firstOrderTick===undefined&&selected.some(s=>s.order.type!=="hold"))firstOrderTick=game.tick;
    if(firstMotionTick===undefined&&selected.some(s=>Math.hypot(s.x-origins.get(s.id).x,s.y-origins.get(s.id).y)>8))firstMotionTick=game.tick;
    if(allOrdersTick===undefined&&admitted.size===selected.length)allOrdersTick=game.tick;
    if(kind==="enemy-gap"&&game.squad(blocker.id)?.troops>0&&selected.some(s=>s.x>49.5*FIXED))enemyBreach=true;
    if(selected.every(arrived)){arrivalTick=game.tick;break;}
    const receipt=game.commandApplications.apply("v11-profile",command);
    if(receipt.status==="rejected"||receipt.status==="superseded")break;
    if(game.winner!==null)break;
  }
  const summarize=values=>{const sorted=[...values].sort((a,b)=>a-b);return {mean:values.reduce((s,v)=>s+v,0)/values.length,p95:sorted[Math.ceil(sorted.length*.95)-1],maximum:sorted[sorted.length-1]};};
  const result={kind,count,ticks:game.tick,wallMs:performance.now()-start,initial,receipt:game.commandApplications.apply("v11-profile",command),firstOrderTick,firstMotionTick,allOrdersTick,arrivalTick,boats,totalBoats:launched.size,enemyBreach,surviving:selected.filter(s=>game.squad(s.id)).length,arrived:selected.filter(arrived).length,tick:summarize(timings),routing:summarize(routing),movement:summarize(movement),planner:game.routePlanner.diagnostics};
  results.push(result);console.log(JSON.stringify(result));
}
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({source:process.env.GIT_COMMIT??"local",node:process.version,architecture:process.arch,ticks,results},null,2)+"\n");
