import {describe,it,expect} from "vitest";
import {GameMapImpl} from "../../src/core/game/GameMap";
import {Skirmish} from "../../src/skirmish/Simulation";
import {FIXED} from "../../src/skirmish/Protocol";
import {retainSquads} from "./UnitFixtures";

function fixture(){
  const data=new Uint8Array(80*50).fill(133);
  for(let y=0;y<50;y++)data[y*80+24]=0;
  const game=new Skirmish(new GameMapImpl(80,50,data,data.filter(t=>t&128).length),{seed:42,aiCount:1,tribes:false,runAi:false,deferredPlanning:true});
  const own=structuredClone(game.squads.find(s=>s.playerId===1)!);
  const enemy=structuredClone(game.squads.find(s=>s.playerId===2)!);
  const units=retainSquads(game,[{...own,x:15.5*FIXED,y:20.5*FIXED},
    {...enemy,x:20.5*FIXED,y:20.5*FIXED,troops:1000000},
    {...enemy,id:100,x:22.5*FIXED,y:20.5*FIXED,troops:1000000},
    {...enemy,id:101,x:25.5*FIXED,y:20.5*FIXED,troops:1000000}]);
  return {game,own:units[0],original:units[1],reachable:units[2],island:units[3]};
}
describe("player attack continuation",()=>{
  it("does not chase an enemy indefinitely outside the attack area",()=>{
    const {game,own,original,reachable}=fixture();
    game.applyCommand({type:"order",playerId:1,squadIds:[own.id],order:{type:"attack",targetId:original.id}});
    game.updateSquad(original.id,{y:42.5*FIXED});game.step();
    expect(own.order).toEqual({type:"attack",targetId:reachable.id});
  });
  it("suppresses an unreachable target and switches to another reachable enemy",()=>{
    const {game,own,original,reachable}=fixture();
    game.applyCommand({type:"order",playerId:1,squadIds:[own.id],order:{type:"attack",targetId:original.id}});
    game.playerAttacks.failed(own,original,game.tick,game.tileOf(original));game.step();
    expect(own.order).toEqual({type:"attack",targetId:reachable.id});
    expect(game.playerAttacks.diagnostics.unreachable).toBe(1);
  });
  it("reacquires a nearby reachable enemy after target loss and restores the pursuit",()=>{
    const {game,own,original,reachable}=fixture();
    expect(game.applyCommand({type:"order",playerId:1,squadIds:[own.id],order:{type:"attack",targetId:original.id}})).toBeNull();
    game.removeSquad(original.id);game.step();
    expect(own.order).toEqual({type:"attack",targetId:reachable.id});
    expect(game.playerAttacks.diagnostics.retargets).toBe(1);
    const restored=new Skirmish(game.map,game.options);restored.restore(game.checkpoint());
    for(let i=0;i<30;i++){game.step();restored.step();}
    expect(restored.checkpoint()).toEqual(game.checkpoint());
  });
  it("respects explicit Hold and does not pursue disconnected enemies",()=>{
    const {game,own,original,reachable}=fixture();
    game.applyCommand({type:"order",playerId:1,squadIds:[own.id],order:{type:"attack",targetId:original.id}});
    game.removeSquad(original.id);game.removeSquad(reachable.id);
    for(let i=0;i<65;i++)game.step();
    expect(own.order.type).toBe("hold");
    const point={x:own.x,y:own.y};
    game.applyCommand({type:"order",playerId:1,squadIds:[own.id],order:{type:"hold"}});
    for(let i=0;i<20;i++)game.step();
    expect({x:own.x,y:own.y}).toEqual(point);
  });
  it("a queued move takes precedence over opportunistic pursuit",()=>{
    const {game,own,original}=fixture();
    game.applyCommand({type:"order",playerId:1,squadIds:[own.id],order:{type:"attack",targetId:original.id}});
    game.applyCommand({type:"order",playerId:1,squadIds:[own.id],order:{type:"move",tile:game.map.ref(10,25)},append:true});
    game.removeSquad(original.id);game.step();expect(own.order.type).toBe("move");
    expect(game.playerAttacks.diagnostics.retargets).toBe(0);
  });
});
