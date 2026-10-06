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
it("uses researched shore transport instead of unreachable land attack orders",()=>{
  const f=fixture(true); f.think();
  const transfers=f.game.checkpoint().shorePlanning.pending;
  expect(transfers).toHaveLength(1);
  expect(transfers[0][1].destination).toBe(f.game.tileOf(f.enemy));
  expect(transfers[0][1].members.map(m=>m.id)).toEqual([f.defender.id]);
  expect(f.commands.mock.calls.some(([c])=>c.type==="order" && c.playerId===2 && c.order.type==="attack")).toBe(false);
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
