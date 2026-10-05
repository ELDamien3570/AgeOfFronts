import { GameMapImpl } from "../../../src/core/game/GameMap";
import { FIXED } from "../../../src/skirmish/Protocol";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { SnapshotEncoder, snapshotTransfers } from "../../../src/skirmish/SnapshotCodec";

let timer: ReturnType<typeof setInterval> | undefined;
self.onmessage = (event: MessageEvent<{type:"start"|"stop"}>) => {
  if (event.data.type === "stop") { clearInterval(timer); self.close(); return; }
  try {
    const terrain=new Uint8Array(192*128).fill(133),game=new Skirmish(new GameMapImpl(192,128,terrain,terrain.length),
      {seed:42,aiCount:14,tribes:false,runAi:false,ruleset:"ages-v1"});
    const template=game.squads[0];for(const squad of game.squads)game.removeSquad(squad.id);
    for(let at=0;at<1500;at++)game.addSquad({...template,id:game.allocateId(),playerId:1+Math.floor(at/100),
      x:(30+at%40*2)*FIXED,y:(24+Math.floor(at/40)*2)*FIXED,order:{type:"hold"},path:[],queuedOrders:[],definitionId:undefined});
    for(let at=0;at<200;at++)game.addBuilding({id:game.allocateId(),playerId:1,type:"tower",tile:at+192*5,remainingTicks:0,health:2000,maxHealth:2000});
    const encoder=new SnapshotEncoder(true);
    const publish=(stepMs:number)=>{
      const start=performance.now(),packet=encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts());
      self.postMessage({packet,stepMs,encodeMs:performance.now()-start,sentAt:performance.timeOrigin+performance.now(),squads:game.squads.length},{transfer:snapshotTransfers(packet)});
    };
    publish(0);
    timer=setInterval(()=>{try {const start=performance.now();game.step();publish(performance.now()-start);}catch(error){clearInterval(timer);self.postMessage({error:String(error)});}},50);
  } catch (error) { self.postMessage({error:String(error)}); }
};

