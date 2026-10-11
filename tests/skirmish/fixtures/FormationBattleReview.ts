import { FIXED,type Squad } from '../../../src/skirmish/Protocol';
import { UNIT } from '../../../src/skirmish/content/Units';
import { createFormation,TURN } from '../../../src/skirmish/domain/FormationGeometry';
import { createManpower } from '../../../src/skirmish/domain/Manpower';
import { canCharge } from '../../../src/skirmish/client/ChargeReadiness';
import { cavalryImpactScene } from './CavalryImpact';

/** Authored preview orders run through the real simulation. No combat or
 * animation results are scripted. Each army has 24 infantry and six cavalry. */
export function formationBattleReviewScene(){
  const {game,rider}=cavalryImpactScene(),template=structuredClone(rider);
  for(const s of [...game.squads])game.removeSquad(s.id);
  // Keep the match's starting cities, but place them outside the battle field.
  for(const [i,b] of game.buildings.entries())game.updateBuilding(b.id,{tile:game.map.ref(b.playerId===1?3:60,Math.min(60,3+i*3))});
  const armies:[Squad[],Squad[]]=[[],[]];
  const cavalry:{squad:Squad;tick:number;column:number}[]=[];
  for(let side=0;side<2;side++){
    const facing=side===0?0:TURN/2,sign=side===0?-1:1,front=side===0?27:35;
    const add=(id:string,x:number,y:number)=>{
      const definition=UNIT.get(id)!,n=definition.formationRecipe!.capacity;
      const s=game.addSquad({...template,id:game.allocateId(),playerId:side+1,definitionId:id,kind:definition.line,
        troops:n,manpower:createManpower(definition),formation:{...createFormation(id),facing,layoutTroops:n},
        x:Math.round(x*FIXED),y:Math.round(y*FIXED),order:{type:'hold'},path:[],queuedOrders:[],
        charge:null,chargeImpact:undefined,cavalryEngagement:undefined,cavalryMelee:undefined,meleeStrike:undefined,
        weaponState:undefined,nextAttackTick:0,lastAttackTick:undefined,refit:null,combatTargetId:null,fighting:false});
      armies[side].push(s);return s;
    };
    for(let rank=0;rank<3;rank++)for(let column=0;column<8;column++)add('bronzeage-infantry',20+column*3.4,front+sign*rank*3.2);
    for(let flank=0;flank<2;flank++)for(let rank=0;rank<3;rank++){
      const squad=add('bronzeage-cavalry',flank===0?15.5:48.3,front+sign*(2+rank*2.5));
      cavalry.push({squad,tick:60+rank*18+side*8,column:flank===0?0:7});
    }
  }
  const commandAttack=(s:Squad,target:Squad)=>{
    const error=game.applyCommand({type:'order',playerId:s.playerId,squadIds:[s.id],order:{type:'attack',targetId:target.id}});
    if(error)throw Error(error);
  };
  for(let side=0;side<2;side++)for(let i=0;i<24;i++)commandAttack(armies[side][i],armies[1-side][i%8]);
  for(const entry of cavalry)commandAttack(entry.squad,armies[entry.squad.playerId===1?1:0][entry.column]);
  const launched=new Set<number>();
  const launch=()=>{
    for(const entry of cavalry){
      const s=game.squad(entry.squad.id);if(!s||s.troops<=0||game.tick<entry.tick||launched.has(s.id))continue;
      const enemy=armies[s.playerId===1?1:0];
      const preferred=game.squad(enemy[entry.column].id);
      const target=preferred&&preferred.troops>0?preferred:enemy.find(p=>game.squad(p.id)&&p.troops>0);
      if(!target)continue;
      if(!canCharge(s,game.tick,target.x,target.y))continue;
      const error=game.applyCommand({type:'charge',playerId:s.playerId,squadIds:[s.id],x:target.x,y:target.y,targetId:target.id});
      if(error)throw Error(error);
      launched.add(s.id);
    }
    for(let side=0;side<2;side++)for(const entry of armies[side]){
      const s=game.squad(entry.id);if(!s||s.troops<=0||s.kind==='cavalry'&&!launched.has(s.id))continue;
      const target=s.order.type==='attack'?game.squad(s.order.targetId):undefined;
      if(target&&target.troops>0)continue;
      if(s.charge && s.charge.targetId!==undefined && (game.squad(s.charge.targetId)?.troops??0)>0)continue;
      let nearest:Squad|undefined,best=Infinity;
      for(const candidate of armies[1-side]){
        const other=game.squad(candidate.id);if(!other||other.troops<=0)continue;
        const distance=(other.x-s.x)**2+(other.y-s.y)**2;
        if(distance<best){best=distance;nearest=other;}
      }
      if(nearest)commandAttack(s,nearest);
    }
  };
  return {game,riders:armies[0],defenders:armies[1],launch};
}
