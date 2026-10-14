import {expect,it} from 'vitest';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {FIXED} from '../../src/skirmish/Protocol';
import {createFormation} from '../../src/skirmish/domain/FormationGeometry';

it('allows neutral formation passage, blocks raid/war opponents, and permits passage again after peace',()=>{
  const cells=new Uint8Array(96*64).fill(133);
  const game=new Skirmish(new GameMapImpl(96,64,cells,cells.length),{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1',diplomacyRules:'raids-v1'});
  const source=game.squads.find(s=>s.playerId===1)!,other=game.squads.find(s=>s.playerId===2)!;
  for(const squad of game.squads)game.updateSquad(squad.id,{x:80*FIXED,y:50*FIXED,order:{type:'hold'}});
  game.updateSquad(source.id,{x:20.5*FIXED,y:20.5*FIXED,formation:createFormation(source.definitionId!)});
  game.updateSquad(other.id,{x:23.5*FIXED,y:20.5*FIXED,formation:createFormation(other.definitionId!)});
  const harness=game as any;harness.spatial.rebuild(game.squads);
  const end={x:other.x,y:other.y},d=game.expansion!.diplomacy;
  expect(harness.formationMoveClear(source,end)).toBe(true);
  d.recordTheft(1,2,0);expect(harness.formationMoveClear(source,end)).toBe(false);
  d.establishWar(1,2,0);expect(harness.formationMoveClear(source,end)).toBe(false);
  d.action(game.players[0],game.players[1],'offer-peace',0);d.action(game.players[1],game.players[0],'accept-peace',0);
  expect(harness.formationMoveClear(source,end)).toBe(true);
  game.expansion!.fortifications.addBarrier({id:game.allocateId(),a:1,b:2,playerId:2,age:'StoneAge',health:2000,maxHealth:2000,remainingTicks:0,tiles:[game.tileOf(other)]});
  expect(harness.formationMoveClear(source,end)).toBe(false);
});
