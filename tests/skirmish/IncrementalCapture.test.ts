import {describe,expect,it} from "vitest";
import {GameMapImpl} from "../../src/core/game/GameMap";
import {Skirmish} from "../../src/skirmish/Simulation";
import {FIXED} from "../../src/skirmish/Protocol";

describe("incremental capture dependencies",()=>{
  it("matches cold reconstruction across movement, defenses, ownership, diplomacy and removals",()=>{
    const data=new Uint8Array(96*64).fill(133),map=new GameMapImpl(96,64,data,data.length);
    const options={seed:47,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1" as const};
    const game=new Skirmish(map,options),internal=game as unknown as {changeOwner(tile:number,id:number):void};
    const first=game.squads.find(s=>s.playerId===1)!,second=game.squads.find(s=>s.playerId===2)!;
    game.updateSquad(first.id,{x:40.5*FIXED,y:30.5*FIXED});
    game.updateSquad(second.id,{x:44.5*FIXED,y:30.5*FIXED});
    const tile=map.ref(42,30);
    let tower=0;
    for(let tick=0;tick<28;tick++){
      if(tick===4)game.updateSquad(first.id,{x:41.5*FIXED});
      if(tick===6)tower=game.addBuilding({id:game.allocateId(),playerId:2,type:"tower",tile,remainingTicks:0,health:1000}).id;
      if(tick===8)game.removeBuilding(tower);
      if(tick===10)internal.changeOwner(tile,2);
      if(tick===12)game.expansion!.diplomacy.state.alliances.push({id:900,a:1,b:2,expiresTick:1000,renewal:[]});
      if(tick===14)game.expansion!.diplomacy.state.alliances=[];
      if(tick===16)game.updateSquad(second.id,{playerId:1});
      if(tick===18)game.removeSquad(first.id);
      const cold=new Skirmish(map,options);cold.restore(game.checkpoint());
      game.step();cold.step();
      expect(game.checkpoint()).toEqual(cold.checkpoint());
    }
  });
});
