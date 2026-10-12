import { describe, expect, it } from 'vitest';
import { GameMapImpl } from '../../src/core/game/GameMap';
import { Skirmish } from '../../src/skirmish/Simulation';
import { FIXED } from '../../src/skirmish/Protocol';
import { AttackApproaches } from '../../src/skirmish/AttackApproaches';
import { createFormation } from '../../src/skirmish/domain/FormationGeometry';
import { createManpower } from '../../src/skirmish/domain/Manpower';
import { UNIT } from '../../src/skirmish/content/Units';

function scene(){
  const data=new Uint8Array(64*64).fill(133),map=new GameMapImpl(64,64,data,data.length);
  const game=new Skirmish(map,{seed:42,aiCount:1,runAi:false,tribes:false,ruleset:'ages-v1'});
  const template=structuredClone(game.squads[0]),unit=UNIT.get('stoneage-infantry')!;
  for(const s of [...game.squads])game.removeSquad(s.id);
  const add=(owner:number,x:number,y:number)=>game.addSquad({...template,id:game.allocateId(),playerId:owner,
    definitionId:unit.id,kind:unit.line,troops:unit.formationRecipe!.capacity,manpower:createManpower(unit),
    formation:createFormation(unit.id),x:x*FIXED,y:y*FIXED,order:{type:'hold'},path:[],queuedOrders:[]});
  return {game,map,add,unit};
}
describe('map-edge melee approaches',()=>{
  it.each([[-1,32],[64,32],[32,-1],[32,64],[NaN,32],[Infinity,32]])('rejects candidate (%s,%s) without throwing',(x,y)=>{
    const {game,add}=scene(),s=add(1,32,32);
    expect(game.formationFits(s,{x:x*FIXED,y:y*FIXED})).toBe(false);
    game.updateSquad(s.id,{formation:undefined});
    expect(game.formationFits(s,{x:x*FIXED,y:y*FIXED})).toBe(false);
    expect(game.formationFits(s,{x:32*FIXED,y:32*FIXED})).toBe(true);
  });
  it.each([[.5,32],[63.5,32],[32,.5],[32,63.5],[.5,.5],[63.5,63.5]])('continues crowded melee planning at edge (%s,%s)',(x,y)=>{
    const {game,map,add,unit}=scene(),target=add(2,x,y);
    // Enough attackers to force outer candidate rings beyond every map edge.
    const attackers=Array.from({length:18},(_,i)=>add(1,28+i%3,28+Math.floor(i/3)));
    for(const s of attackers)game.updateSquad(s.id,{order:{type:'attack',targetId:target.id}});
    const approaches=new AttackApproaches();let outside=0,assigned=0;
    approaches.rebuild([target,...attackers],()=>true,(s,p)=>{
      if(!map.isValidCoord(Math.floor(p.x/FIXED),Math.floor(p.y/FIXED)))outside++;
      return game.formationFits(s,p);
    },undefined,{tick:game.tick,reach:()=>unit.attack.range});
    expect(outside).toBeGreaterThan(0);
    for(const s of attackers){const p=approaches.point(s);if(p){assigned++;expect(map.isValidCoord(Math.floor(p.x/FIXED),Math.floor(p.y/FIXED))).toBe(true);}}
    expect(assigned).toBeGreaterThan(0);
    const initial=game.tick;
    for(let i=0;i<20;i++)game.step();
    expect(game.tick).toBe(initial+20);
  });
});
