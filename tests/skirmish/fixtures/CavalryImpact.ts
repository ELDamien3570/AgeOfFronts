import { GameMapImpl } from '../../../src/core/game/GameMap';
import { Skirmish } from '../../../src/skirmish/Simulation';
import { FIXED } from '../../../src/skirmish/Protocol';
import { UNIT, UNITS } from '../../../src/skirmish/content/Units';
import { createManpower } from '../../../src/skirmish/domain/Manpower';
import { createFormation, TURN } from '../../../src/skirmish/domain/FormationGeometry';
import { formationApproach } from '../../../src/skirmish/domain/FormationContact';
import { FORMATION_MOVEMENT } from '../../../src/skirmish/content/FormationMovement';
export function cavalryImpactScene(flank=false,spears=false){
  const terrain=new Uint8Array(64*64).fill(133);
  const game=new Skirmish(new GameMapImpl(64,64,terrain,terrain.length),{seed:42,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1',...FORMATION_MOVEMENT});
  const template=structuredClone(game.squads[0]);for(const squad of [...game.squads])game.removeSquad(squad.id);
  const add=(id:string,owner:number,y:number,facing:number)=>{
    const definition=UNIT.get(id)!,n=definition.formationRecipe!.capacity;
    return game.addSquad({...template,id:game.allocateId(),playerId:owner,definitionId:id,kind:definition.line,troops:n,
      manpower:createManpower(definition),formation:{...createFormation(id),facing,layoutTroops:n},
      x:32*FIXED,y:y*FIXED,order:{type:'hold'},path:[],queuedOrders:[],charge:null,refit:null,combatTargetId:null});
  };
  const rider=add('bronzeage-cavalry',1,29,0);
  const id=spears?UNITS.find(u=>u.age==='BronzeAge'&&u.troopClass==='antiCavalry')!.id:'bronzeage-infantry';
  const defender=add(id,2,32,flank?TURN/4:TURN/2);
  game.updateSquad(rider.id,{charge:{phase:'committed',x:defender.x,y:defender.y,startTick:0,committedTick:0,targetId:defender.id},formation:{...rider.formation!,shape:'wedge',transition:undefined}});
  game.updateSquad(rider.id,formationApproach(rider,defender,0,0,-Math.PI/2));
  return {game,rider,defender};
}

/** Explicit legacy order, with the original spacing for rank-motion contracts. */
export function cavalryRankScene(flank=false,spears=false){
  const scene=cavalryImpactScene(flank,spears);
  scene.game.updateSquad(scene.rider.id,{order:{type:'attack',targetId:scene.defender.id,cavalryMode:'ranks'}});
  Object.assign(scene.game,{cavalryRankLaunchSpacing:()=>1});
  return scene;
}

/** Three legal charge orders against two infantry lines; no precommitted charges. */
export function cavalryBattleScene(flank=false,spears=false){
  const {game,rider:template}=cavalryImpactScene();
  for(const squad of [...game.squads])game.removeSquad(squad.id);
  const add=(id:string,owner:number,x:number,y:number,facing:number)=>{
    const unit=UNIT.get(id)!,n=unit.formationRecipe!.capacity;
    return game.addSquad({...template,id:game.allocateId(),playerId:owner,definitionId:id,kind:unit.line,troops:n,
      manpower:createManpower(unit),formation:{...createFormation(id),facing,layoutTroops:n},
      x:x*FIXED,y:y*FIXED,order:{type:'hold'},path:[],queuedOrders:[],charge:null,chargeImpact:undefined,combatTargetId:null});
  };
  const foot=spears?UNITS.find(u=>u.age==='BronzeAge'&&u.troopClass==='antiCavalry')!.id:'bronzeage-infantry';
  const riders=[],defenders=[],launches:{tick:number;riderId:number;targetId:number}[]=[];
  for(let lane=0;lane<3;lane++){
    const x=26+lane*6;
    const front=add(foot,2,x,32,flank?TURN/4:TURN/2);
    defenders.push(front,add(foot,2,x+1,35,TURN/2));
    const rider=add('bronzeage-cavalry',1,x,25,0);riders.push(rider);
    launches.push({tick:lane*8,riderId:rider.id,targetId:front.id});
  }
  const launch=()=>{
    for(const order of launches)if(order.tick===game.tick){
      const target=game.squad(order.targetId)!;
      const error=game.applyCommand({type:'charge',playerId:1,squadIds:[order.riderId],x:target.x,y:target.y,targetId:target.id});
      if(error)throw Error(error);
    }
  };
  return {game,riders,defenders,launch};
}
