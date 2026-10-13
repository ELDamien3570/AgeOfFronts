import {readFileSync,writeFileSync} from 'node:fs';
import {deserialize} from 'node:v8';
import {Skirmish} from '../src/skirmish/Simulation';
import {generateMigration} from '../src/skirmish/MigrationMap';
import {FIXED} from '../src/skirmish/Protocol';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: checkLateGameOrder.ts checkpoint.v8 result.json');
const saved=deserialize(readFileSync(input)),playerId=3;
saved.players.find((p:{id:number})=>p.id===playerId).ai=false;
const game=new Skirmish(generateMigration(saved.width,saved.options.seed).map,saved.options);game.restore(saved);
const squad=game.squads.find(s=>s.playerId===playerId&&s.embarkedOn===null&&!s.afloat&&!s.refit&&!s.charge&&!s.structureTarget&&s.kind==='infantry');
if(!squad)throw Error('No available test squad');
const x=Math.floor(squad.x/FIXED),y=Math.floor(squad.y/FIXED);
const goal=[[3,0],[0,3],[-3,0],[0,-3]].map(([dx,dy])=>({x:x+dx,y:y+dy})).find(p=>game.map.isValidCoord(p.x,p.y)&&game.map.isLand(game.map.ref(p.x,p.y))&&game.squadPaths(playerId).connected(game.tileOf(squad),game.map.ref(p.x,p.y))&&!game.expansion?.fortifications.blocked(game.map.ref(p.x,p.y),playerId));
if(!goal)throw Error('No nearby legal test destination');
const start=game.tick;
let origin={x:squad.x,y:squad.y};
let admissionTick:number|undefined,movementTick:number|undefined;
game.commandApplications.onOutcome=event=>{
  if(event.id!=='late-game-check')return;
  if(event.status==='rejected')throw Error(event.reason);
  if(event.status==='executed'){admissionTick=event.tick-start;origin={x:squad.x,y:squad.y};}
};
game.commandApplications.apply('late-game-check',{type:'order',playerId,squadIds:[squad.id],order:{type:'move',tile:game.map.ref(goal.x,goal.y)}});
for(let i=0;i<80;i++){
  game.step();
  if(admissionTick!==undefined&&(squad.x!==origin.x||squad.y!==origin.y)){movementTick=game.tick-start;break;}
}
const result={input,initialTick:start,squadId:squad.id,admissionTicks:admissionTick,movementTicks:movementTick,finalOrder:squad.order,
  limitations:'Headless worker command-to-admission/motion in game ticks; excludes browser input and presentation.'};
writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if(admissionTick===undefined||movementTick===undefined)throw Error('Late-game order did not admit and move within 80 ticks');
