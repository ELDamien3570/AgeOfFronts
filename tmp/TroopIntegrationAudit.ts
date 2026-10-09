import { TroopActors } from "../src/skirmish/client/troops/TroopActors";
import { RUSSIAN_TROOP_ACTORS } from "../src/skirmish/client/troops/RussianTroopCatalogue";
import { Skirmish } from "../src/skirmish/Simulation";
import { GameMapImpl } from "../src/core/game/GameMap";
import { UNIT } from "../src/skirmish/content/Units";
import { FIXED } from "../src/skirmish/Protocol";
const canvas = document.querySelector<HTMLCanvasElement>("#audit")!;
const ctx = canvas.getContext("2d")!;
let time=1000;
const actors = new TroopActors(()=>time,{troops:[...RUSSIAN_TROOP_ACTORS.values()],byDefinitionId:RUSSIAN_TROOP_ACTORS,reformInPlace:true,formationForSquad:()=>"mass"});
actors.isSelected=()=>true;
await actors.load();
const terrain = new Uint8Array(80*60).fill(133);
const game = new Skirmish(new GameMapImpl(80,60,terrain,terrain.length),{seed:42,aiCount:1,tribes:false,runAi:false});
const snapshot = game.snapshot(), base = snapshot.squads[0];
const squads=[...RUSSIAN_TROOP_ACTORS.keys()].map((id,index)=>({...base,id:index+1,definitionId:id,playerId:1,x:(index%6*10+5)*FIXED,y:(Math.floor(index/6)*9+5)*FIXED,troops:1000,fighting:false,order:{type:"hold" as const},combatTargetId:null}));
actors.prune({...snapshot,squads,buildings:[],volleys:[]});
actors.beginFrame();
for(const [i,squad] of squads.entries()){
const p={x:i%6*260+130,y:Math.floor(i/6)*240+130};
ctx.fillStyle="white";ctx.font="15px sans-serif";ctx.fillText(UNIT.get(squad.definitionId!)!.name,p.x-100,p.y-100);
actors.draw(ctx,squad,p,0,24,20,{x:squad.x/FIXED,y:squad.y/FIXED});
}
actors.flush(ctx);
(document.body as HTMLElement).dataset.ready=String(actors.drawnSoldiers);
