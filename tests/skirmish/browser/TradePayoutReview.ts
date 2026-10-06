import { GameMapImpl } from "../../../src/core/game/GameMap";
import { Renderer } from "../../../src/skirmish/client/Renderer";
import { Skirmish } from "../../../src/skirmish/Simulation";
const terrain=new Uint8Array(64*64).fill(133);terrain.fill(0,48*64);
const map=new GameMapImpl(64,64,terrain,48*64);
const game=new Skirmish(map,{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1"});
for(const b of game.buildings.slice())game.removeBuilding(b.id);
for(const s of game.squads.slice())game.removeSquad(s.id);
const city=game.addBuilding({id:game.allocateId(),playerId:1,type:"city",tile:map.ref(20,20),age:"StoneAge",remainingTicks:0});
const port=game.addBuilding({id:game.allocateId(),playerId:2,type:"port",tile:map.ref(40,47),age:"StoneAge",remainingTicks:0});
const hidden=game.addBuilding({id:game.allocateId(),playerId:2,type:"city",tile:map.ref(40,20),age:"StoneAge",remainingTicks:0});
const renderer=new Renderer(document.querySelector<HTMLCanvasElement>("#battlefield")!);
renderer.setMap(map);renderer.update(game.snapshot());
let receipt=0;
document.querySelector("#receipt")!.addEventListener("click",()=>{
  const snapshot=game.snapshot();snapshot.expansion!.tradeReceipts=[
    {id:++receipt,tick:0,playerId:1,tile:city.tile,gold:100},
    {id:++receipt,tick:0,playerId:1,tile:port.tile,gold:900},
    {id:++receipt,tick:0,playerId:2,tile:hidden.tile,gold:999}];
  renderer.update(snapshot);
});
const frame=(now:number)=>{renderer.draw(now,1,true);requestAnimationFrame(frame);};requestAnimationFrame(frame);
