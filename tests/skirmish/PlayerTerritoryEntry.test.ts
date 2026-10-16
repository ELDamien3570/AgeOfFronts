import {describe,expect,it} from 'vitest';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {FIXED} from '../../src/skirmish/Protocol';
import {remainingHealth} from '../../src/skirmish/domain/Manpower';
import {transportScene} from './fixtures/TacticalScenes';

function walkingScene(ai=false) {
 const cells=new Uint8Array(96*64).fill(133);
 const game=new Skirmish(new GameMapImpl(96,64,cells,cells.length),{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1',aiWarPolicy:true,diplomacyRules:'raids-v1'});
 const squad=game.squads.find(s=>s.playerId===1)!;
 for(const other of [...game.squads])if(other.id!==squad.id)game.removeSquad(other.id);
 const state=game.checkpoint();state.owners.fill(2);game.restore(state);
 game.updateSquad(squad.id,{x:30.01*FIXED,y:20.5*FIXED,order:{type:'hold'},formation:undefined});
 game.setAiController(1,ai);
 return {game,s:game.squad(squad.id)!,d:game.expansion!.diplomacy};
}

function crossingScene(ai=false) {
 const f=transportScene(12),game=new Skirmish(f.map,{...f.options,diplomacyRules:'raids-v1',aiWarPolicy:true});
 const state=f.game.checkpoint();state.options={...state.options,diplomacyRules:'raids-v1',aiWarPolicy:true};state.owners.fill(0);
 // The eastern shore owns the adjacent sea as well as the destination land.
 for(let y=0;y<f.size;y++)for(let x=90;x<f.size;x++)state.owners[f.map.ref(x,y)]=2;
 game.restore(state);game.setAiController(1,ai);
 return {game,s:game.squad(f.s.id)!,d:game.expansion!.diplomacy};
}

function move(f:ReturnType<typeof walkingScene>,x:number,y:number) {
 expect(f.game.applyCommand({type:'order',playerId:1,squadIds:[f.s.id],order:{type:'move',tile:f.game.map.ref(x,y)}})).toBeNull();
}

function placeAfloat(f:ReturnType<typeof crossingScene>,x:number) {
 const vessel=f.game.transportVessel(1)!;
 f.game.updateSquad(f.s.id,{x:x*FIXED,y:64.5*FIXED,afloat:{hull:vessel.health,maxHull:vessel.health,vesselId:vessel.id,passengerHealth:remainingHealth(f.s),passengerHullDamage:0}});
}

describe('human squad territorial entry',()=>{
 it('declares on the first committed movement even within the same foreign tile',()=>{
  const f=walkingScene(),start={x:f.s.x,y:f.s.y};move(f,34,20);
  for(let i=0;i<100&&f.s.x===start.x&&f.s.y===start.y;i++)f.game.step();
  expect(f.s.x).toBeGreaterThan(start.x);expect(f.game.tileOf(f.s)).toBe(f.game.map.ref(30,20));
  expect(f.d.state.wars).toContainEqual({a:1,b:2,initiator:1,cause:'entry',startedTick:f.game.tick});
 });
 it('does not declare merely because a stationary squad occupies foreign land',()=>{
  const f=walkingScene();for(let i=0;i<5;i++)f.game.step();expect(f.d.state.wars).toEqual([]);
 });
 it('declares while afloat on entering foreign sea, before reaching the shore',()=>{
  const f=crossingScene();move(f,110,64);
  for(let i=0;i<1800&&!f.d.declaredWar(1,2);i++)f.game.step();
  expect(f.d.declaredWar(1,2)).toBe(true);expect(f.s.afloat).toBeTruthy();
  expect(f.game.map.isWater(f.game.tileOf(f.s))).toBe(true);expect(f.game.owners[f.game.tileOf(f.s)]).toBe(2);
  expect(f.d.state.wars?.[0]).toMatchObject({initiator:1,cause:'entry'});
 });
 it('declares on landing even when the adjacent water already has the same owner',()=>{
  const f=crossingScene();
  placeAfloat(f,95.9);
  move(f,110,64);
  for(let i=0;i<100&&f.s.afloat;i++)f.game.step();
  expect(f.s.afloat).toBeFalsy();expect(f.d.declaredWar(1,2)).toBe(true);
 });
 it('allows allied movement without declaring war',()=>{
  const f=walkingScene();f.d.state.alliances.push({id:1,a:1,b:2,expiresTick:10000,renewal:[]});
  const start=f.s.x;move(f,34,20);for(let i=0;i<30;i++)f.game.step();
  expect(f.s.x).toBeGreaterThan(start);expect(f.d.state.wars).toEqual([]);
 });
 it('preserves peace protection when an invasion is ordered',()=>{
  const f=walkingScene();f.d.state.peaceProtection!.push({a:1,b:2,untilTick:1000});
  expect(f.game.applyCommand({type:'order',playerId:1,squadIds:[f.s.id],order:{type:'move',tile:f.game.map.ref(34,20)}})).toContain('cannot be reached');
  for(let i=0;i<30;i++)f.game.step();expect(f.d.state.wars).toEqual([]);
 });
 it('preserves AI withdrawal grace without automatically declaring war',()=>{
  const f=walkingScene(true),start={x:f.s.x,y:f.s.y};
  for(let i=0;i<30;i++)f.game.step();
  expect(f.s.aiWithdrawal?.phase).toBe('withdrawing');
  expect(Math.hypot(f.s.x-start.x,f.s.y-start.y)).toBeGreaterThan(0);expect(f.d.state.wars).toEqual([]);
 });
 it('does not turn an AI raid into war when its transported squad enters foreign sea',()=>{
  const f=crossingScene(true);
  placeAfloat(f,88.5);
  expect(f.d.beginAiRaid(f.game.player(1)!,f.game.player(2),f.game.tick)).toBeNull();
  move(f,94,64);
  const start=f.s.x;
  for(let i=0;i<30;i++)f.game.step();
  expect(f.s.x).toBeGreaterThan(start);expect(f.s.afloat).toBeTruthy();
  expect(f.game.owners[f.game.tileOf(f.s)]).toBe(2);expect(f.d.state.wars).toEqual([]);
 });
});
