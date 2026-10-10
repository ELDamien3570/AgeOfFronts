import fs from 'node:fs';
import path from 'node:path';
import {GameMapImpl} from '../src/core/game/GameMap.ts';
import {Skirmish} from '../src/skirmish/Simulation.ts';
import {FIXED} from '../src/skirmish/Protocol.ts';
const args=process.argv.slice(2),out=args[args.indexOf('--out')+1]??'out/1.2-all-passes/combat.json';
const data=new Uint8Array(96*64).fill(133),game=new Skirmish(new GameMapImpl(96,64,data,data.length),{seed:47,aiCount:1,tribes:false,runAi:false,deferredPlanning:true});
const template=structuredClone(game.squads.find(s=>s.playerId===1));
for(const s of [...game.squads])game.removeSquad(s.id);
game.owners.fill(1);
// Geometry fixture: retain combat/targeting work but suppress casualties so both rosters persist.
game.resolveLandDamage=()=>{};
const enemies=Array.from({length:5},(_,i)=>game.addSquad({...structuredClone(template),id:game.allocateId(),playerId:2,x:(32.5+i%2*2)*FIXED,y:(26.5+Math.floor(i/2)*2)*FIXED,troops:100000,nextAttackTick:100000,order:{type:'hold'},path:[],queuedOrders:[]}));
const own=Array.from({length:30},(_,i)=>game.addSquad({...structuredClone(template),id:game.allocateId(),x:(22.5+i%5)*FIXED,y:(25.5+Math.floor(i/5))*FIXED,order:{type:'hold'},path:[],queuedOrders:[]}));
game.applyCommand({type:'order',playerId:1,squadIds:own.map(s=>s.id),order:{type:'attack',targetId:enemies[0].id}});
let overlaps=0,idle=0,active=0,distinct=0,firstContact;const tickTimes=[],movement=[],routing=[];
game.onPhase=(phase,ms)=>{if(phase==='tick')tickTimes.push(ms);if(phase==='movement')movement.push(ms);if(phase==='routing')routing.push(ms);};
for(let t=0;t<600;t++){
 game.step();if(firstContact===undefined&&own.some(s=>s.fighting))firstContact=game.tick;
 if(t<100)continue;
 const alive=own.filter(s=>game.squad(s.id));active+=alive.length;
 distinct+=new Set(alive.filter(s=>s.order.type==='attack').map(s=>s.order.targetId)).size;
 for(let i=0;i<alive.length;i++){
  const s=alive[i];if(!s.moved&&!s.fighting&&enemies.some(e=>game.squad(e.id)&&Math.hypot(e.x-s.x,e.y-s.y)<12*FIXED))idle++;
  if(alive.some((o,j)=>j!==i&&Math.hypot(o.x-s.x,o.y-s.y)<.5*FIXED))overlaps++;
 }
}
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return {mean:values.reduce((n,x)=>n+x,0)/values.length,p95:sorted[Math.ceil(sorted.length*.95)-1],maximum:sorted.at(-1)};};
const result={immortalGeometryFixture:true,ticks:game.tick,firstContact,overlapFraction:overlaps/active,idleReachableFraction:idle/active,meanDistinctTargets:distinct/500,surviving:own.filter(s=>game.squad(s.id)).length,tick:summary(tickTimes),movement:summary(movement),routing:summary(routing),playerRetargets:game.playerAttacks.diagnostics,planner:game.routePlanner.diagnostics};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
