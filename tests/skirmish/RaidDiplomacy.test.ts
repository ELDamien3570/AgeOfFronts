import {secondsToTicks} from '../../src/skirmish/Protocol';
import {describe,it,expect,vi} from 'vitest';
import {Diplomacy} from '../../src/skirmish/domain/Diplomacy';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {SnapshotEncoder,SnapshotDecoder} from '../../src/skirmish/SnapshotCodec';
import {commandSchema} from '../../src/skirmish/multiplayer/CommandSchema';
import {FIXED} from '../../src/skirmish/Protocol';
import {defaultUnit,VESSELS} from '../../src/skirmish/content/Units';
import {ARMY_TECHNOLOGY} from '../../src/skirmish/content/Armies';
import {remainingHealth} from '../../src/skirmish/domain/Manpower';
import type {TradeActor} from '../../src/skirmish/domain/Definitions';
function fixture(){const cells=new Uint8Array(96*64).fill(133);const game=new Skirmish(new GameMapImpl(96,64,cells,cells.length),{seed:47,aiCount:2,tribes:false,runAi:false,ruleset:'ages-v1',aiWarPolicy:true,diplomacyRules:'raids-v1'});return {game,d:game.expansion!.diplomacy,a:game.players[0],b:game.players[1]};}
describe('raid diplomacy permissions',()=>{
 it('legacy matches reject new diplomacy actions instead of treating them as alliance offers',()=>{
  const {a,b}=fixture(),legacy=new Diplomacy();
  for(const action of ['offer-peace','accept-peace','reject-peace','dont-embargo','allow-embargo'] as const)
    expect(legacy.action(a,b,action,0)).toContain('legacy');
  expect(legacy.state.offers).toEqual([]);
 });
 it('an explicit AI raid opens interception and unit combat, expires without theft, and honors peace',()=>{
  const {game,d,a,b}=fixture();expect(d.canSteal(b.id,a.id,0,false)).toBe(false);
  expect(d.beginAiRaid(b,a,0)).toBeNull();expect(d.canSteal(b.id,a.id,0,false)).toBe(true);
  expect(d.hostile(a.id,b.id)).toBe(true);expect(d.canCapture(b.id,a.id)).toBe(false);
  expect(d.beginAiRaid(a,b,0)).toContain('AI raid');d.step(secondsToTicks(60),game.players);expect(d.hostile(a.id,b.id)).toBe(false);
  d.beginAiRaid(b,a,secondsToTicks(60.05));d.action(a,b,'offer-peace',secondsToTicks(60.1));d.action(b,a,'accept-peace',secondsToTicks(60.15));
  expect(d.beginAiRaid(b,a,secondsToTicks(60.2))).toContain('Peace');
 });
 it('prefers unclaimed expansion at parity, but permits preparing retaliation against a trade raider',()=>{
  const {game,d,a,b}=fixture();b.personalityId='balanced';
  for(const player of game.players){player.reserves=2000;const template=game.squads.find(s=>s.playerId===player.id)!;
    for(let i=0;i<12;i++)game.addSquad({...structuredClone(template),id:game.allocateId(),x:template.x+i*FIXED,y:template.y});}
  game.players[2].eliminated=true;
  // Parity is the actual deployable force after retaining four home squads,
  // rather than parity only before the invader's reserve is withheld.
  game.expansion!.progression.states[b.id].age='BronzeAge';
  game.expansion!.progression.states[b.id].completed.push(ARMY_TECHNOLOGY);
  for(const s of game.squadFacts().aliveByOwner(a.id).slice(-4))game.removeSquad(s.id);
  const eligible=vi.spyOn(game.expansion!.geography,'eligible').mockReturnValue(true);
  const forces=new Map(game.players.map(p=>[p.id,game.squadFacts().aliveByOwner(p.id).length]));game.tick=secondsToTicks(150);game.expansion!.operations.step(forces);
  expect(game.hasUnclaimedFrontier(b.id)).toBe(true);expect(game.expansion!.operations.state(b.id)?.phase).toBe('peace');
  d.recordTheft(a.id,b.id,game.tick);game.tick+=secondsToTicks(15);game.expansion!.operations.step(forces);
  expect(game.expansion!.operations.state(b.id)).toMatchObject({phase:'preparing',target:a.id});
  expect(d.declaredWar(a.id,b.id)).toBe(false);eligible.mockRestore();
 });
 it('a warship discards a building attack during a raid and can fire once war is established',()=>{
  const {game,d}=fixture(),vessel=[...VESSELS.values()].find(v=>v.attack?.targets.includes('structure'))!;
  const target=game.addBuilding({id:game.allocateId(),tile:game.map.ref(20,20),playerId:2,type:'city',age:'StoneAge',remainingTicks:0,health:2000,maxHealth:2000});
  const ship=game.addShip({id:game.allocateId(),playerId:1,kind:'warship',definitionId:vessel.id,x:19.5*FIXED,y:20.5*FIXED,health:vessel.health,destination:null,waypoints:[],path:[],nextPathIndex:0,fighting:false,attackTargetId:target.id});
  const fire=vi.spyOn(game.expansion!.battle,'fire');d.recordTheft(1,2,0);(game as any).fightShips();
  expect(fire).not.toHaveBeenCalled();expect(ship.attackTargetId).toBeNull();expect(target.health).toBe(2000);
  const enemy=game.addShip({...structuredClone(ship),id:game.allocateId(),playerId:2,x:22*FIXED});
  expect(game.applyCommand({type:'naval-attack',playerId:1,shipIds:[ship.id],targetId:enemy.id})).toBeNull();
  expect(game.applyCommand({type:'naval-attack',playerId:1,shipIds:[ship.id],targetId:target.id})).toContain('enemy');
  d.establishWar(1,2,0);game.updateShip(ship.id,{attackTargetId:target.id});(game as any).fightShips();
  expect(fire.mock.calls.length>0||target.health!<2000).toBe(true);fire.mockRestore();
 });
 it('peace and theft exemptions remain available when alliances are disabled',()=>{
  const {game,d}=fixture();game.options.alliances=false;d.recordTheft(1,2,0);
  expect(game.applyCommand({type:'alliance',playerId:1,otherId:2,action:'dont-embargo'})).toBeNull();
  expect(game.applyCommand({type:'alliance',playerId:1,otherId:2,action:'offer-peace'})).toBeNull();
  expect(game.applyCommand({type:'alliance',playerId:2,otherId:1,action:'accept-peace'})).toBeNull();
  expect(d.protected(1,2)).toBe(true);
  expect(game.applyCommand({type:'alliance',playerId:1,otherId:2,action:'offer'})).toContain('disabled');
 });
 it('real overland interception transfers cargo and begins a raid automatically for a human',()=>{
  const {game,d}=fixture(),s=game.squads.find(s=>s.playerId===1)!;
  game.updateSquad(s.id,{x:40*FIXED,y:20*FIXED});
  const actor:TradeActor={id:game.allocateId(),playerId:2,factoryId:-1,definitionId:'caravan',naval:false,x:s.x,y:s.y,cargo:10,loaded:10,delivered:0,lost:0,returned:0,valuePerGood:1,originTile:game.map.ref(40,20),capacity:25,shipmentId:1,stops:[],visited:[],destination:null,state:'outbound',path:[],nextPathIndex:0,waitTicks:0,quoteAllies:[]};
  game.expansion!.trade.actors.push(actor);game.tick=1;game.expansion!.trade.step();
  expect(actor.playerId).toBe(1);expect(actor.state).toBe('prize');expect(d.state.embargoes).toEqual([{initiator:1,victim:2,lastTheftTick:1}]);expect(d.declaredWar(1,2)).toBe(false);
 });
 it('human physical entry declares war, while stationary foreign ownership does not',()=>{
  const {game,d}=fixture(),s=game.squads.find(s=>s.playerId===1)!;
  for(const other of game.squads)game.updateSquad(other.id,{x:(other.playerId===1?10:80)*FIXED,y:50*FIXED,order:{type:'hold'}});
  const state=game.checkpoint();state.owners.fill(0);for(let y=0;y<64;y++)for(let x=30;x<96;x++)state.owners[game.map.ref(x,y)]=2;game.restore(state);
  game.updateSquad(s.id,{x:29.9*FIXED,y:20.5*FIXED,order:{type:'move',tile:game.map.ref(34,20)},path:[game.map.ref(30,20),game.map.ref(31,20),game.map.ref(32,20),game.map.ref(34,20)],nextPathIndex:0});
  for(let i=0;i<30&&!d.declaredWar(1,2);i++)game.step();expect(d.declaredWar(1,2)).toBe(true);expect(d.state.wars?.[0].cause).toBe('entry');
  const fresh=fixture(),unit=fresh.game.squads.find(s=>s.playerId===1)!;fresh.game.owners[fresh.game.tileOf(unit)]=2;fresh.game.step();expect(fresh.d.declaredWar(1,2)).toBe(false);
 });
 it('a raid cannot capture territory, buildings, enclosed pockets or defeat-inherited land',()=>{
  const {game,d}=fixture(),s=game.squads.find(s=>s.playerId===1)!,tile=game.map.ref(40,20);d.recordTheft(1,2,0);
  game.owners[tile]=2;game.updateSquad(s.id,{x:40.5*FIXED,y:20.5*FIXED,order:{type:'hold'}});
  expect(game.expansion!.canCaptureTile(s,tile)).toBe(false);(game as any).changeOwner(tile,1);expect(game.owners[tile]).toBe(2);
  const b=game.addBuilding({id:game.allocateId(),tile,playerId:2,type:'factory',age:'StoneAge',remainingTicks:0});game.owners[tile]=0;
  expect(game.expansion!.canCaptureTile(s,tile)).toBe(false);(game as any).changeOwner(tile,1);expect(b.playerId).toBe(2);
  d.establishWar(1,2,1);expect(game.expansion!.canCaptureTile(s,tile)).toBe(true);
 });
 it('a shot already in flight damages its original enemy after accepted peace',()=>{
  const {game,d,a,b}=fixture(),source=game.squads.find(s=>s.playerId===1)!,target=game.squads.find(s=>s.playerId===2)!;
  for(const unit of game.squads)game.updateSquad(unit.id,{x:80*FIXED,y:50*FIXED,order:{type:'hold'}});
  game.updateSquad(source.id,{x:5*FIXED,y:20*FIXED});game.updateSquad(target.id,{x:10*FIXED,y:20*FIXED,formation:undefined});d.establishWar(1,2,0);
  const attack={...defaultUnit('archer').attack,perSoldier:false,damage:100,bonuses:{},targets:['infantry'] as const,projectile:{diameter:FIXED/4,speed:30*FIXED,blastRadius:0}};
  const before=remainingHealth(target);game.expansion!.battle.fire(source,{x:20*FIXED,y:20*FIXED},attack,100);
  d.action(a,b,'offer-peace',0);d.action(b,a,'accept-peace',0);expect(d.hostile(1,2)).toBe(false);
  game.tick++;game.expansion!.battle.advanceProjectiles();expect(remainingHealth(target)).toBeLessThan(before);
 });
 it('neutrality prevents military attacks and foreign capture while preserving unclaimed expansion',()=>{const {d}=fixture();expect(d.hostile(1,2)).toBe(false);expect(d.canCapture(1,2)).toBe(false);expect(d.canCapture(1,0)).toBe(true);expect(d.canSteal(1,2,0,true)).toBe(true);expect(d.canSteal(2,1,0,false)).toBe(false);});
 it('actual theft establishes directional raid and mutual combat but no conquest',()=>{const {d}=fixture();d.recordTheft(1,2,secondsToTicks(0.5));expect(d.state.embargoes).toEqual([{initiator:1,victim:2,lastTheftTick:secondsToTicks(0.5)}]);expect(d.hostile(1,2)).toBe(true);expect(d.hostile(2,1)).toBe(true);expect(d.canCapture(1,2)).toBe(false);expect(d.canAttackStructure(1,2)).toBe(false);});
 it('theft refresh does not invalidate permission caches and expiry removes raid permission',()=>{const {d,game}=fixture();d.recordTheft(1,2,0);const revision=d.permissionSignature(1);d.recordTheft(1,2,secondsToTicks(5));expect(d.permissionSignature(1)).toBe(revision);d.step(secondsToTicks(65)-1,game.players);expect(d.hostile(1,2)).toBe(true);d.step(secondsToTicks(65),game.players);expect(d.hostile(1,2)).toBe(false);expect(d.permissionSignature(1)).not.toBe(revision);});
 it('exemption suppresses peacetime theft but leaves raid and wartime theft intact',()=>{const {d,a,b}=fixture();d.recordTheft(1,2,0);expect(d.action(a,b,'dont-embargo',1)).toBeNull();expect(d.embargo(1,2)).toBe(true);expect(d.canSteal(1,2,1,true)).toBe(false);d.establishWar(1,2,secondsToTicks(0.1),'entry');expect(d.canSteal(1,2,secondsToTicks(0.1),true)).toBe(true);expect(d.state.wars?.[0]).toMatchObject({initiator:1,cause:'entry',startedTick:secondsToTicks(0.1)});});
 it('accepted peace ends raids and war, protects for one minute and persists cooldowns',()=>{const {d,a,b,game}=fixture();d.establishWar(1,2,0);expect(d.action(a,b,'offer-peace',1)).toBeNull();expect(d.action(b,a,'accept-peace',secondsToTicks(0.1))).toBeNull();expect(d.declaredWar(1,2)).toBe(false);expect(d.hostile(1,2)).toBe(false);expect(d.canSteal(1,2,secondsToTicks(0.15),true)).toBe(false);expect(d.establishWar(1,2,secondsToTicks(0.15))).toContain('Peace');const restored=new Diplomacy(undefined,'raids-v1');restored.restore(d.checkpoint());restored.step(secondsToTicks(0.15),game.players);expect(restored.protected(1,2)).toBe(true);restored.step(secondsToTicks(60.1),game.players);expect(restored.protected(1,2)).toBe(false);restored.establishWar(1,2,secondsToTicks(60.15));expect(restored.action(a,b,'offer-peace',secondsToTicks(60.2))).toContain('cooldown');});
 it('AI threat observation cannot manufacture neutral combat/capture permission',()=>{const {d,game}=fixture();game.expansion!.operations.threatened(2,1,game.players[1].base);expect(d.hostile(1,2)).toBe(false);expect(game.expansion!.operations.canTarget(2,1)).toBe(false);expect(game.expansion!.operations.canEnter(2,1,game.players[0].base)).toBe(false);});
 it('AI prepares an invasion but waits for a route certificate before declaring actual war',()=>{
  const {game,d,b}=fixture(),template=game.squads.find(s=>s.playerId===b.id)!;b.reserves=2000;
  for(let i=0;i<12;i++)game.addSquad({...structuredClone(template),id:game.allocateId(),x:template.x+i*FIXED,y:template.y});
  game.expansion!.operations.restore({records:[[b.id,{phase:'preparing',target:1,since:0,nextThink:0,threats:[],cursor:0,score:0}]],revision:0,territorialRevision:0});
  const quote=vi.spyOn(game.expansion!.economy.routes,'request').mockReturnValue({pending:true});
  game.tick=secondsToTicks(50);game.expansion!.operations.step(new Map(game.players.map(p=>[p.id,p.id===b.id?15:3])));
  expect(d.declaredWar(1,2)).toBe(false);expect(quote).toHaveBeenCalled();
  quote.mockReturnValue({pending:false,path:[b.base,game.players[0].base]});game.tick=secondsToTicks(55);
  game.expansion!.operations.step(new Map(game.players.map(p=>[p.id,p.id===b.id?15:3])));expect(d.state.wars).toContainEqual({a:2,b:1,initiator:2,cause:'invasion',startedTick:secondsToTicks(55)});quote.mockRestore();
 });
 it('new actions pass the authoritative multiplayer command schema and states survive codec',()=>{const {d,a,b,game}=fixture();for(const action of ['offer-peace','accept-peace','reject-peace','dont-embargo','allow-embargo'])expect(commandSchema.safeParse({type:'alliance',playerId:1,otherId:2,action}).success).toBe(true);d.recordTheft(1,2,0);d.action(a,b,'dont-embargo',0);const decoded=new SnapshotDecoder().decodeLatest(new SnapshotEncoder().encode(game.snapshot(),game.tileChanges,game.replicationFacts()));expect(decoded.expansion?.diplomacy.embargoes).toEqual(d.state.embargoes);expect(decoded.expansion?.diplomacyRules).toBe('raids-v1');});
});
