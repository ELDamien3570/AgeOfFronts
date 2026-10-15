import {TICKS_PER_SECOND} from '../Protocol';
import { damageAmount,defenceOf } from './Combat';
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
  for(const a of own)for(const b of enemy){
    const attack=a.unit.attack;
    const targetWidth=b.width/Math.max(1,b.count);
    const contributors=attack.channel==='melee'&&attack.perSoldier
      ?Math.min(a.contributors,targetWidth*a.count*(a.shape==='modern-loose'?1:attack.ranks??2)):a.contributors;
    const facts=formationModifiers(b.shape,b.deployed,attack.channel,context.arc??'front',a.unit.tags.includes('mounted'));
    total+=damageAmount(attack,{...defenceOf(b.unit,context.cover),tacticalBp:facts.bp},attack.perSoldier?contributors:1000,a.xp,1000,undefined,context.elevationBpA??context.elevationBp??10000)
      *(attack.perSoldier?1:a.strength)*(b.health/health)*TICKS_PER_SECOND/Math.max(1,sustainedInterval(attack));
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
