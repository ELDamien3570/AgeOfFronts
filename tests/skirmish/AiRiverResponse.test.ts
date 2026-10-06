import { expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED } from "../../src/skirmish/Protocol";
import { VESSELS } from "../../src/skirmish/content/Units";
import { retainSquads } from "./UnitFixtures";

function fixture(transport: boolean) {
  const cells=new Uint8Array(64*48).fill(133);
  for(let y=23;y<=25;y++)cells.fill(0,y*64,(y+1)*64);
  const map=new GameMapImpl(64,48,cells,2880);
  const game=new Skirmish(map,{seed:42,aiCount:1,tribes:false,runAi:true,ruleset:"ages-v1",deferredPlanning:true});
  const defender=game.squads.find(s=>s.playerId===2)!,enemy=game.squads.find(s=>s.playerId===1)!;
  retainSquads(game,[defender,enemy]);
  game.players[1].base=map.ref(32,12);game.players[1].gold=0;game.players[1].reserves=0;
  for(let tile=0;tile<cells.length;tile++)game.owners[tile]=map.y(tile)<23?2:1;
  game.tick=(1-defender.id%15+15)%15;
  game.updateSquad(defender.id,{x:32.5*FIXED,y:22.5*FIXED,kind:"infantry",definitionId:"stoneage-infantry",order:{type:"hold"},lastCombatTick:game.tick});
  game.updateSquad(enemy.id,{x:32.5*FIXED,y:26.5*FIXED,kind:"archer",definitionId:"stoneage-archer",order:{type:"hold"}});
  game.expansion!.progression.states[2].completed=[];
  if(transport)game.expansion!.progression.states[2].completed.push(VESSELS.find(v=>v.kind==="transport")!.technologyId);
  const commands=vi.spyOn(game,"applyCommand");
  return {game,map,defender,enemy,commands,think:()=> (game as unknown as {thinkAi():void}).thinkAi()};
}
it("crosses the river amphibiously when transport is researched",()=>{
  const f=fixture(true); f.think();
  const orders=f.commands.mock.calls.map(([c])=>c).filter(c=>c.type==="order" && c.playerId===2 && c.squadIds.includes(f.defender.id));
  const move=orders.find(c=>c.type==="order" && c.order.type==="move");
  expect(move).toBeDefined();
  if(move?.type==="order" && move.order.type==="move") {
    // The destination is on the far bank: only reachable over water.
    expect(f.map.isLand(move.order.tile)).toBe(true);
    expect(f.map.y(move.order.tile)).toBeGreaterThan(25);
    expect(f.game.paths.connected(f.game.tileOf(f.defender),move.order.tile)).toBe(false);
    expect(f.game.squadPaths(2).connected(f.game.tileOf(f.defender),move.order.tile)).toBe(true);
  }
  expect(orders.some(c=>c.type==="order" && c.order.type==="attack")).toBe(false);
  f.game.options.runAi=false;
  let afloat=false;
  for(let i=0;i<120 && !afloat;i++){f.game.step(); afloat=!!f.defender.afloat;}
  expect(afloat).toBe(true);
  expect(f.defender.afloat?.vesselId).toBe(VESSELS.find(v=>v.kind==="transport")!.id);
  expect(f.defender.y).toBeGreaterThan(22.5*FIXED);
  // A land destination keeps its slot ashore: the squad lands rather than
  // idling afloat beside the enemy it cannot fight from the water.
  for(let i=0;i<400 && (f.defender.afloat || f.defender.order.type!=="hold");i++)f.game.step();
  const live=f.game.squad(f.defender.id);
  if(live)expect(live.afloat ?? null).toBeNull();
});
it("withdraws from unreachable ranged fire when embarkation is unavailable",()=>{
  const f=fixture(false); f.think();
  const move=f.commands.mock.calls.map(([c])=>c).find(c=>c.type==="order" && c.playerId===2 && c.order.type==="move");
  expect(move).toBeDefined();
  if(move?.type==="order" && move.order.type==="move") {
    expect(f.game.paths.connected(f.game.tileOf(f.defender),move.order.tile)).toBe(true);
    expect(f.map.euclideanDistSquared(move.order.tile,f.game.tileOf(f.enemy))).toBeGreaterThan(8**2);
  }
  f.game.options.runAi=false;
  for(let i=0;i<120;i++)f.game.step();
  expect(f.defender.y).toBeLessThan(22.5*FIXED);
});
