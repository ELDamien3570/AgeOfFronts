import fs from "node:fs";
import path from "node:path";
import {GameMapImpl} from "../src/core/game/GameMap.ts";
import {Skirmish} from "../src/skirmish/Simulation.ts";
import {FIXED} from "../src/skirmish/Protocol.ts";
const args=process.argv.slice(2),out=args[args.indexOf("--out")+1]??"out/v1.1-investigation/retargeting.json";
const results=[];
for(const hold of [false,true]){
  const data=new Uint8Array(96*64).fill(133),game=new Skirmish(new GameMapImpl(96,64,data,data.length),{seed:47,aiCount:1,tribes:false,runAi:false,deferredPlanning:true});
  const template=structuredClone(game.squads.find(s=>s.playerId===1));
  for(const squad of [...game.squads])game.removeSquad(squad.id);
  const enemy=x=>game.addSquad({...structuredClone(template),id:game.allocateId(),playerId:2,x:x*FIXED,y:30.5*FIXED,troops:1000,nextAttackTick:100000,order:{type:"hold"},path:[],queuedOrders:[]});
  const original=enemy(30.5),replacement=enemy(28.5);
  const own=Array.from({length:100},(_,i)=>game.addSquad({...structuredClone(template),id:game.allocateId(),x:(18.5+i%10)*FIXED,y:(25.5+Math.floor(i/10))*FIXED,order:{type:"hold"},path:[],queuedOrders:[]}));
  game.applyCommand({type:"order",playerId:1,squadIds:own.map(s=>s.id),order:{type:"attack",targetId:original.id}});
  if(hold)game.applyCommand({type:"order",playerId:1,squadIds:own.map(s=>s.id),order:{type:"hold"}});
  game.removeSquad(original.id);
  const acquired=new Map(),durations=[],start=performance.now();
  for(let i=0;i<40;i++){
    const before=performance.now();game.step();durations.push(performance.now()-before);
    for(const squad of own)if(squad.order.type==="attack"&&squad.order.targetId===replacement.id&&!acquired.has(squad.id))acquired.set(squad.id,game.tick);
  }
  durations.sort((a,b)=>a-b);
  results.push({hold,count:own.length,retargeted:acquired.size,firstTick:Math.min(...acquired.values()),lastTick:acquired.size?Math.max(...acquired.values()):null,
    wallMs:performance.now()-start,tickP95Ms:durations[Math.ceil(durations.length*.95)-1],diagnostics:game.playerAttacks?.diagnostics??null});
}
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({results},null,2)+"\n");console.log(JSON.stringify(results));
