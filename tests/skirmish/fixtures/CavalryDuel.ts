import { GameMapImpl } from '../../../src/core/game/GameMap';
import { Skirmish } from '../../../src/skirmish/Simulation';
import { FIXED, TICKS_PER_SECOND } from '../../../src/skirmish/Protocol';
import { UNIT } from '../../../src/skirmish/content/Units';
import { createManpower, remainingHealth } from '../../../src/skirmish/domain/Manpower';
import { createFormation, TURN } from '../../../src/skirmish/domain/FormationGeometry';
import { FORMATION_MOVEMENT } from '../../../src/skirmish/content/FormationMovement';

/**
 * A rider against one foot block, built in either creation order. The fight
 * loop visits squads in id order, so any effect applied in place during the
 * loop shows up as a difference between the two orders (R2-L1, C2).
 */
export function cavalryDuel(riderId:string,footId:string,opts:{defenderFirst?:boolean;mode?:'charge'|'assault'|'held';gap?:number;x?:number}={}){
  const terrain=new Uint8Array(96*96).fill(133);
  const game=new Skirmish(new GameMapImpl(96,96,terrain,terrain.length),{seed:42,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1',...FORMATION_MOVEMENT});
  const template=structuredClone(game.squads[0]);
  for(const s of [...game.squads])game.removeSquad(s.id);
  for(const b of [...game.buildings])game.removeBuilding(b.id);
  // Formation templates are seeded by id % 16, so the swapped build keeps each
  // body's seed and changes only which combatant the fight loop visits first.
  const pool=Array.from({length:17},()=>game.allocateId());
  if(pool[16]-pool[0]!==16)throw Error('ids are not sequential');
  const ids=opts.defenderFirst?{foot:pool[1],rider:pool[16]}:{rider:pool[0],foot:pool[1]};
  const add=(id:string,owner:number,y:number,facing:number)=>{
    const unit=UNIT.get(id)!,n=unit.formationRecipe!.capacity,m=createManpower(unit);
    // Durable foot keeps the duel going for the whole window.
    return game.addSquad({...template,id:owner===1?ids.rider:ids.foot,playerId:owner,definitionId:id,kind:unit.line,troops:n,
      manpower:owner===2?{...m,hp:m.hp*1000}:m,formation:{...createFormation(id),shape:'mass',facing,layoutTroops:n},
      x:(opts.x??48)*FIXED,y:y*FIXED,order:{type:'hold'},path:[],queuedOrders:[],charge:null,refit:null,combatTargetId:null,xp:0});
  };
  const gap=opts.gap??10;
  let rider,foot;
  if(opts.defenderFirst){foot=add(footId,2,48,TURN/2);rider=add(riderId,1,48-gap,0);}
  else {rider=add(riderId,1,48-gap,0);foot=add(footId,2,48,TURN/2);}
  // 'held': the rider holds and the foot attacks it.
  const command=opts.mode==='held'
    ?{type:'order' as const,playerId:2,squadIds:[foot.id],order:{type:'attack' as const,targetId:rider.id}}
    :opts.mode==='assault'
    ?{type:'order' as const,playerId:1,squadIds:[rider.id],order:{type:'attack' as const,targetId:foot.id}}
    :{type:'charge' as const,playerId:1,squadIds:[rider.id],targetId:foot.id,x:foot.x,y:foot.y};
  const error=game.applyCommand(command);if(error)throw Error(error);
  return {game,riderId:rider.id,footId:foot.id};
}

/** Per-tick HP loss on both sides from first contact for `seconds`. */
export function duelTrace(scene:ReturnType<typeof cavalryDuel>,seconds=6){
  const {game,riderId,footId}=scene;
  let footHp=remainingHealth(game.squad(footId)!),riderHp=remainingHealth(game.squad(riderId)!),first=-1;
  const footLoss:[number,number][]=[],riderLoss:[number,number][]=[];
  for(let i=0;i<30*TICKS_PER_SECOND;i++){
    game.step();
    const f=game.squad(footId),r=game.squad(riderId);if(!f||!r)break;
    const fh=remainingHealth(f),rh=remainingHealth(r);
    if(first<0 && fh<footHp)first=game.tick;
    if(first>=0){
      if(fh!==footHp)footLoss.push([game.tick-first,footHp-fh]);
      if(rh!==riderHp)riderLoss.push([game.tick-first,riderHp-rh]);
      if(game.tick-first>=seconds*TICKS_PER_SECOND)break;
    }
    footHp=fh;riderHp=rh;
  }
  return {first,footLoss,riderLoss};
}
