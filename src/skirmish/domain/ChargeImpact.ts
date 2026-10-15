import { secondsToTicks } from '../Protocol';
import { TACTICAL_CHARGE } from '../content/TacticalRules';
import { damageAmount, type Defence } from './Combat';
import { contactParticipants, formationContact } from './FormationContact';
import { formationEnvelope } from './FormationGeometry';
import { tacticalDefence } from './FormationTactics';
import type { AttackProfile } from './Definitions';
import type { Squad } from '../Protocol';
import { commitWeaponShot,type WeaponState } from './WeaponTiming';
/** Impact is a commitment, even if the preceding ordinary swing is cooling down. */
export function commitChargeShot(profile:AttackProfile,state:WeaponState|undefined,tick:number,recoveryTicks:number):WeaponState {
  const available={...state,sharedReadyTick:tick,melee:state?.melee?{...state.melee,nextTick:tick}:undefined};
  const committed=commitWeaponShot({...profile,channel:'melee'},available,tick,false)!;
  return {...committed,sharedReadyTick:Math.max(committed.sharedReadyTick,state?.sharedReadyTick??0,tick+recoveryTicks)};
}
/** A single committed impact. Legal targets are supplied by Battle. */
export function resolveChargeImpact(source:Squad,targets:readonly Squad[],profile:AttackProfile,tick:number,defence:(s:Squad)=>Defence){
  const contacts=targets.map(target=>({target,contact:formationContact(source,target,tick)}))
    .sort((a,b)=>a.contact.gap-b.contact.gap||a.target.id-b.target.id).slice(0,TACTICAL_CHARGE.maxTargets);
  const wedge=formationEnvelope(source,tick).shape==='wedge'&&!source.formation?.transition?TACTICAL_CHARGE.wedgeFrontage:1;
  const contributors=(target:Squad,contact:ReturnType<typeof formationContact>)=>Math.min(source.troops,
    Math.ceil(contactParticipants(source,target,tick,1,contact)*wedge));
  const frontage=contacts.reduce((n,c)=>Math.max(n,contributors(c.target,c.contact)),0);
  const budget=(profile.damage+Math.max(0,...Object.values(profile.bonuses)))*frontage*TACTICAL_CHARGE.budgetFactor;
  let remaining=budget;
  const hits=contacts.map(({target,contact})=>{
    const count=contributors(target,contact);
    const damage=Math.min(remaining,damageAmount(profile,tacticalDefence(source,target,tick,'melee',defence(target),true),count,source.xp));
    remaining-=damage;
    return {target,damage,contributors:count};
  });
  return {budget,hits,total:budget-remaining};
}
/** Bounded reaction offsets; roots remain authoritative. */
export interface ChargeImpact {
  tick:number;
  role:'rider'|'defender';
  sourceId:number;
  disruptedUntilTick:number;
  x:number;y:number;
  dx:number;dy:number;
  /** Ordinary rank contacts may affect fewer bodies than a full charge. */
  participants?:number;
  radius?:number;
}
export const CHARGE_IMPACT = Object.freeze({duration:secondsToTicks(1.2),disruption:secondsToTicks(.4),maxOffset:160,maxRiderOffset:256,maxMembers:8});
export function chargeDisrupted(s:{chargeImpact?:ChargeImpact},tick:number):boolean {
  return s.chargeImpact?.role==='defender' && tick<s.chargeImpact.disruptedUntilTick;
}
export function validateChargeImpact(value:ChargeImpact|undefined,tick=Infinity):void {
  if(value===undefined)return;
  if(!value || !Number.isSafeInteger(value.tick)||value.tick<0||value.tick>tick ||
    !['rider','defender'].includes(value.role)||!Number.isSafeInteger(value.sourceId)||value.sourceId<0||
    !Number.isSafeInteger(value.disruptedUntilTick)||value.disruptedUntilTick<value.tick||value.disruptedUntilTick>value.tick+CHARGE_IMPACT.disruption||
    [value.x,value.y,value.dx,value.dy].some(n=>!Number.isFinite(n)||Math.abs(n)>2147483647)||
    Math.hypot(value.dx,value.dy)>(value.role==='rider'?CHARGE_IMPACT.maxRiderOffset:CHARGE_IMPACT.maxOffset)+1||
    value.participants!==undefined&&(!Number.isSafeInteger(value.participants)||value.participants<1||value.participants>CHARGE_IMPACT.maxMembers)||
    value.radius!==undefined&&(!Number.isFinite(value.radius)||value.radius<=0||value.radius>512))throw Error('Invalid cavalry charge impact');
}
