import {TICKS_PER_SECOND} from '../Protocol';
import { damageAmount,defenceOf,type Defence } from './Combat';
import { sustainedInterval } from './WeaponTiming';
import { formationModifiers } from './FormationTactics';
import type { Arc } from './FormationFacing';
import type { FormationDoctrine,FormationShape } from './FormationGeometry';
import type { UnitDefinition } from './Definitions';
import type { Cohort } from './AiCombatPower';

export interface TacticalContext { arc?:Arc; cover?:number; elevationBp?:number; elevationBpA?:number; elevationBpB?:number }
/** Composition-sized estimate. Frontage, armour and shape use live combat rules. */
export function cohortDps(own:readonly Cohort[],enemy:readonly Cohort[],context:TacticalContext={}):number {
  const health=enemy.reduce((n,b)=>n+b.health,0);
  if(!health)return 0;
  let total=0;
  // One defence per enemy cohort holding exactly the fields damageAmount reads
  // (the Defence interface), instead of spreading the whole unit definition
  // for every attacker/target pair. Only tacticalBp varies per pair.
  const defences:Defence[]=enemy.map(b=>{
    const d=defenceOf(b.unit,context.cover);
    return {tags:d.tags,meleeArmour:d.meleeArmour,rangedArmour:d.rangedArmour,armourKind:d.armourKind,
      bonusResistance:d.bonusResistance,soldiers:d.soldiers,cover:d.cover,healthPercent:d.healthPercent,tacticalBp:undefined};
  });
  for(const a of own){
    const attack=a.unit.attack,mounted=a.unit.tags.includes('mounted');
    for(let j=0;j<enemy.length;j++){
      const b=enemy[j],defence=defences[j];
      const targetWidth=b.width/Math.max(1,b.count);
      const contributors=attack.channel==='melee'&&attack.perSoldier
        ?Math.min(a.contributors,targetWidth*a.count*(a.shape==='modern-loose'?1:attack.ranks??2)):a.contributors;
      const facts=formationModifiers(b.shape,b.deployed,attack.channel,context.arc??'front',mounted);
      defence.tacticalBp=facts.bp;
      total+=damageAmount(attack,defence,attack.perSoldier?contributors:1000,a.xp,1000,undefined,context.elevationBpA??context.elevationBp??10000)
        *(attack.perSoldier?1:a.strength)*(b.health/health)*TICKS_PER_SECOND/Math.max(1,sustainedInterval(attack));
    }
  }
  return total;
}
export function engagementEstimate(own:readonly Cohort[],enemy:readonly Cohort[],context:TacticalContext={}){
  const ownDps=cohortDps(own,enemy,context),enemyDps=cohortDps(enemy,own,{elevationBpA:context.elevationBpB});
  const ownHealth=own.reduce((n,c)=>n+c.health,0),enemyHealth=enemy.reduce((n,c)=>n+c.health,0);
  const ratio=!ownHealth?0:!enemyHealth?8:(ownDps/Math.max(1e-9,enemyHealth))/(Math.max(1e-9,enemyDps)/ownHealth);
  return {advantage:Math.round(Math.max(0,Math.min(8,ratio))*1024)/1024,
    ownDps,enemyDps,secondsToBreak:ownDps>0?enemyHealth/ownDps:Infinity};
}
/** Advisory only: choosing a shape never issues an order or overrides player intent. */
export function preferredShape(unit:UnitDefinition,doctrine:FormationDoctrine,threat:{mountedShare:number;rangedShare:number;distanceTiles:number},role:'frontline'|'ranged'|'mounted'|'support'):FormationShape {
  const eligible=(shape:FormationShape)=>doctrine.shapes.includes(shape);
  if(eligible('modern-loose'))return 'modern-loose';
  if(unit.troopClass==='antiCavalry'&&threat.mountedShare>=.35&&threat.distanceTiles<=12&&threat.rangedShare<.5&&eligible('square'))return 'square';
  if(doctrine.shieldEquipment&&threat.rangedShare>=.4&&eligible('shield-wall'))return 'shield-wall';
  if(role==='ranged'&&eligible('line'))return 'line';
  if(role==='mounted'&&unit.charge&&eligible('wedge'))return 'wedge';
  return doctrine.defaultShape;
}
