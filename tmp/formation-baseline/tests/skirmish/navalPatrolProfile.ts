import { writeFileSync } from "node:fs";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { WaterPaths } from "../../src/skirmish/Pathfinding";
import { coastalPatrol } from "../../src/skirmish/domain/CoastalPatrol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED, type Ship } from "../../src/skirmish/Protocol";
const label=process.argv[2] ?? "lanes";
const stats=(values:number[])=>{values.sort((a,b)=>a-b);return {meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:values[Math.ceil(values.length*.95)-1]};};
const cells=new Uint8Array(1000*660).fill(133);cells.fill(0,400*1000);
const map=new GameMapImpl(1000,660,cells,400000),water=new WaterPaths(map),owners=new Uint8Array(cells.length).fill(1);
const itinerary:number[]=[];let waypoints=0;
for(let i=0;i<250;i++){const start=performance.now();waypoints=coastalPatrol(map,water,owners,1,map.ref(500,400)).length;if(i>=50)itinerary.push(performance.now()-start);}
const data=new Uint8Array(256*64).fill(133);data.fill(0,10*256);
const game=new Skirmish(new GameMapImpl(256,64,data,2560),{seed:42,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1"});
const path=Array.from({length:201},(_,i)=>game.map.ref(20+i,25));
for(let i=0;i<1024;i++)game.addShip({id:game.allocateId(),playerId:1,kind:"warship",definitionId:"stoneage-warship",x:20.5*FIXED,y:25.5*FIXED,health:1000,destination:path[path.length-1],waypoints:[],path:[...path],nextPathIndex:0,fighting:false,repairState:"patrolling"});
const movement:number[]=[];
for(let tick=0;tick<200;tick++){
  const start=performance.now();
  for(const ship of game.ships)(game as unknown as {moveShip(ship:Ship,cargo:never[]):void}).moveShip(ship,[]);
  if(tick>=50)movement.push(performance.now()-start);
}
const result={label,scope:"Isolated costs, not a full match or Oracle release benchmark",ships:game.ships.length,waypoints,itineraryBuild:stats(itinerary),allShipMovement:stats(movement),distinctPositions:new Set(game.ships.map(s=>`${s.x},${s.y}`)).size};
writeFileSync(`out/naval-patrol-${label}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
