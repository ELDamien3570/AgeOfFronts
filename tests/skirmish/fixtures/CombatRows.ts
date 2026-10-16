import { GameMapImpl } from '../../../src/core/game/GameMap';
import { Skirmish } from '../../../src/skirmish/Simulation';
import { FIXED, TICKS_PER_SECOND } from '../../../src/skirmish/Protocol';
import { UNIT } from '../../../src/skirmish/content/Units';
import { createManpower, maximumHealth, remainingHealth } from '../../../src/skirmish/domain/Manpower';
import { createFormation, TURN } from '../../../src/skirmish/domain/FormationGeometry';
import type { FormationShape } from '../../../src/skirmish/domain/FormationGeometry';

/**
 * Contract-row arena: real Skirmish.step(), catalog units at full strength on
 * hold, side 1 facing side 2 across `distance` tiles (centre to centre).
 * Each side lists its squads; side 1 squads stand 3 tiles apart abreast.
 */
export function combatRow(side1:{id:string;count?:number;shape?:FormationShape},side2:{id:string;shape?:FormationShape},distance:number){
  const terrain=new Uint8Array(96*96).fill(133);
  const game=new Skirmish(new GameMapImpl(96,96,terrain,terrain.length),{seed:42,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1'});
  const template=structuredClone(game.squads[0]);
  for(const s of [...game.squads])game.removeSquad(s.id);
  for(const b of [...game.buildings])game.removeBuilding(b.id);
  const add=(id:string,owner:number,x:number,y:number,facing:number,shape?:FormationShape)=>{
    const unit=UNIT.get(id)!,n=unit.formationRecipe!.capacity;
    return game.addSquad({...template,id:game.allocateId(),playerId:owner,definitionId:id,kind:unit.line,troops:n,
      manpower:createManpower(unit),formation:{...createFormation(id),...(shape?{shape}:{}),facing,layoutTroops:n},
      x:x*FIXED,y:y*FIXED,order:{type:'hold'},path:[],queuedOrders:[],charge:null,refit:null,combatTargetId:null,xp:0,weaponState:undefined});
  };
  const count=side1.count??1;
  const shooters=Array.from({length:count},(_,i)=>add(side1.id,1,40.5+(i-(count-1)/2)*3,40.5,0,side1.shape).id);
  const target=add(side2.id,2,40.5,40.5+distance,TURN/2,side2.shape).id;
  return {game,shooters,target};
}

/** Fraction (0..1) of `id`'s full health lost when its HP first drops. */
export function firstLoss(game:Skirmish,id:number,seconds=30){
  const max=maximumHealth(game.squad(id)!);
  let before=remainingHealth(game.squad(id)!);
  for(let i=0;i<seconds*TICKS_PER_SECOND;i++){
    game.step();
    const s=game.squad(id),now=s?remainingHealth(s):0;
    if(now<before)return {fraction:(before-now)/max,troops:s?.troops??0,tick:game.tick};
    before=now;
  }
  return {fraction:0,troops:game.squad(id)?.troops??0,tick:game.tick};
}
