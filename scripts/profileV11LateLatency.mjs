import fs from "node:fs";
import path from "node:path";
import {deserialize} from "node:v8";
import {loadServerMap} from "../src/skirmish/multiplayer/infrastructure/ServerMap.ts";
import {defaultLobbySettings} from "../src/skirmish/lobby/LobbyDirectory.ts";
import {createSkirmishMap} from "../src/skirmish/Elevation.ts";
import {Skirmish} from "../src/skirmish/Simulation.ts";
import {FIXED} from "../src/skirmish/Protocol.ts";
import {standable,squadRadius} from "../src/skirmish/SquadGeometry.ts";
import {ARMY_CAPS,ARMY_TECHNOLOGY} from "../src/skirmish/content/Armies.ts";
const args=process.argv.slice(2),value=(key,fallback)=>{const at=args.indexOf(key);return at<0?fallback:args[at+1];};
const out=value("--out","out/v1.1-investigation/late-latency.json"),saved=deserialize(fs.readFileSync(value("--restore","out/transport-land-orders-20261003/trade-movement-placement-recovery/checkpoint-final.v8")));
const loaded=await loadServerMap(defaultLobbySettings(value("--map","valles-kairulia"),Number(value("--size","500"))));
const results=[];
const followThrough=args.includes("--follow-through");
const transport=args.includes("--transport");
const armyFixture=args.includes("--armies");
const count=Number(value("--count","100"));
for(let trial=0;trial<Number(value("--trials","4"));trial++){
  const map=createSkirmishMap(loaded.map.width,loaded.map.height,loaded.map.terrain,loaded.map.elevation,loaded.map.forest,loaded.map.resourceTerrain),game=new Skirmish(map,saved.options);game.restore(saved);
  const player=game.players.filter(p=>p.ai&&p.kind==="regular"&&!p.eliminated).sort((a,b)=>game.squadFacts().byOwner(b.id).length-game.squadFacts().byOwner(a.id).length)[0];
  game.setAiController(player.id,false);
  const template=structuredClone(game.squads.find(s=>s.playerId===player.id&&s.embarkedOn===null&&!s.refit));
  if(!template)throw new Error("No candidate faction");
  const origin=game.tileOf(template),component=game.paths.component[origin],cx=map.x(origin),cy=map.y(origin),spawn=[];
  for(let y=Math.max(0,cy-8);y<=Math.min(map.height()-1,cy+8);y++)for(let x=Math.max(0,cx-8);x<=Math.min(map.width()-1,cx+8);x++){
    const tile=map.ref(x,y),point={x:(x+.5)*FIXED,y:(y+.5)*FIXED};
    if(game.paths.component[tile]===component&&standable(map,point,squadRadius(template.kind)))spawn.push(point);
  }
  if(!spawn.length)throw new Error("No legal fixture positions");
  const squads=Array.from({length:count},(_,i)=>game.addSquad({...structuredClone(template),id:game.allocateId(),...spawn[i%spawn.length],order:{type:"hold"},path:[],queuedOrders:[],refit:null,charge:null,structureTarget:null,embarkedOn:null,fighting:false}));
  const fixtureArmies=[];
  if(armyFixture){
    // Explicit synthetic fixture: unlock Army capacity, retaining the checkpoint's economy.
    const state=game.expansion.progression.states[player.id];
    state.completed=[...new Set([...state.completed,ARMY_TECHNOLOGY,...ARMY_CAPS.map(rule=>rule.technologyId)])];
    const capacity=game.expansion.armies.capacity(player.id);
    for(let at=0;at<squads.length;at+=capacity){
      const group=squads.slice(at,at+capacity),rejection=game.applyCommand({type:"create-army",playerId:player.id,squadIds:group.map(s=>s.id)});
      if(rejection)throw new Error(`Army fixture creation failed: ${rejection}`);
      fixtureArmies.push(game.expansion.armies.armyOf(group[0].id).id);
    }
  }
  const angle=trial*Math.PI/2,desired={x:cx+Math.round(Math.cos(angle)*35),y:cy+Math.round(Math.sin(angle)*35)};
  let goal=origin,best=Infinity;
  for(let tile=0;tile<map.width()*map.height();tile++)if((transport?game.paths.component[tile]!==component:game.paths.component[tile]===component)&&game.paths.walkable(tile)&&map.euclideanDistSquared(origin,tile)>15**2){
    const d=(map.x(tile)-desired.x)**2+(map.y(tile)-desired.y)**2;if(d<best){best=d;goal=tile;}
  }
  const positions=new Map(squads.map(s=>[s.id,{x:s.x,y:s.y}])),startTick=game.tick,start=performance.now();
  const command={type:"order",playerId:player.id,squadIds:squads.map(s=>s.id),order:{type:"move",tile:goal}},initial=game.commandApplications.apply("late-latency",command);
  let firstMotionTicks,firstBoatTicks,firstMotionWallMs,firstBoatWallMs;const originalBoats=new Set(game.ships.map(s=>s.id)),admitted=new Set();for(let i=0;i<(followThrough?1200:240);i++){
    game.step();for(const squad of squads)if(squad.order.type!=="hold"||squad.embarkedOn!==null||Math.hypot(squad.x-positions.get(squad.id).x,squad.y-positions.get(squad.id).y)>8)admitted.add(squad.id);
    if(args.includes("--trace")&&(i<3||i%10===0))console.log(JSON.stringify({trace:true,ticks:i+1,
      admissions:game.movementAdmission.checkpoint().pending.filter(([,p])=>p.playerId===player.id).map(([id,p])=>({id,phase:p.phase,formation:p.formation.phase,count:p.members.length,member:p.member,requested:p.members.filter(m=>m.requested).length,paths:p.members.filter(m=>m.path).length})),
      cohorts:game.routePlanner.diagnosticCohorts(game.tick).filter(c=>c.playerId===player.id),planner:game.routePlanner.diagnostics}));
    if(firstBoatTicks===undefined&&game.ships.some(s=>!originalBoats.has(s.id)&&s.playerId===player.id)){firstBoatTicks=game.tick-startTick;firstBoatWallMs=performance.now()-start;}
    if(firstMotionTicks===undefined&&squads.some(s=>Math.hypot(s.x-positions.get(s.id).x,s.y-positions.get(s.id).y)>8)){firstMotionTicks=game.tick-startTick;firstMotionWallMs=performance.now()-start;}
    if(firstMotionTicks!==undefined&&!followThrough)break;
    if(game.winner!==null||["executed","rejected","superseded"].includes(game.commandApplications.apply("late-latency",command).status))break;
  }
  results.push({trial,transport,armyFixture,fixtureArmies,playerId:player.id,count:squads.length,goal,firstMotionTicks,firstMotionWallMs,firstBoatTicks,firstBoatWallMs,completionTicks:game.tick-startTick,admitted:admitted.size,wallMs:performance.now()-start,initial,receipt:game.commandApplications.apply("late-latency",command),planner:game.routePlanner.diagnostics});
}
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({checkpointTick:saved.tick,results},null,2)+"\n");console.log(JSON.stringify(results));
