import { FIXED, secondsToTicks, type Squad } from '../Protocol';
import { damageAmount, defenceOf } from './Combat';
import type { AttackProfile, UnitDefinition } from './Definitions';
import { isCavalryTroopClass } from './Definitions';
import { formationContact, formationFootprint } from './FormationContact';
import { CAVALRY_ENTRY } from './CavalryEngagement';
import { CONTACT } from '../content/TacticalRules';
import { formationEnvelope } from './FormationGeometry';
import { remainingHealth } from './Manpower';
import { cavalryRankExposure, waveTick, CAVALRY_RANK_MOTION } from './CavalryMelee';
import type { CavalryEngagement } from './CavalryEngagement';
import { recoveredChargeStrength } from './ChargeStrength';

/** Balance calibration, independent of actor animations and render rate. */
export const CAVALRY_ASSAULT = Object.freeze({
  frontResistance: 1.65,
  counterResistance: 3.2,
  squareResistance: 4,
});
export function meleeCavalry(unit:UnitDefinition):boolean {
  return unit.formationRecipe?.model==='soldiers' && isCavalryTroopClass(unit.troopClass) && !!unit.meleeAttack && !!unit.charge;
}

export interface CavalryAssault {
  startTick: number;
  bonusUntilTick: number;
  /** Absent before a bonus is spent; older charge snapshots use startTick. */
  bonusStartTick?: number;
  pendingBonusStrength?: number;
  strength: number;
  penetrates: boolean;
  /** The resolved, terrain-certified receiving edge. World fixed until the next attack. */
  x: number; y: number; nx: number; ny: number;
  halfWidth: number; depth: number; approach: number;
  pressure: number; resistance: number;
}

/** No age lookup or random roll. Armour, counter damage, manpower, facing and
 * deployment determine which side can maintain its contact edge. */
export function cavalryResistance(source: Squad, target: Squad, attacker: UnitDefinition, defender: UnitDefinition, tick: number) {
  const contact = formationContact(target, source, tick);
  const shape = formationEnvelope(target, tick).shape;
  const deployed = !target.formation?.transition && shape !== 'column';
  const front = contact.facing >= .25;
  const weapon = (u: UnitDefinition) => u.meleeAttack ?? (u.attack.channel === 'melee' ? u.attack : undefined);
  const power = (s: Squad, u: UnitDefinition, other: UnitDefinition) => {
    const profile = weapon(u);
    const damage = profile ? damageAmount(profile, defenceOf(other), 1, s.xp) * (profile.rpm ?? 60) / 60 : .1;
    const health = Math.max(1, remainingHealth(s) / Math.max(1, s.troops));
    return Math.sqrt(health * Math.max(.1, damage)) * Math.sqrt(Math.max(1, s.troops));
  };
  const pressure = power(source, attacker, defender);
  const stance = !deployed ? .45 : shape === 'square' ? CAVALRY_ASSAULT.squareResistance :
    !front ? (contact.facing < -.25 ? .3 : .55) :
    defender.troopClass === 'antiCavalry' ? CAVALRY_ASSAULT.counterResistance :
    shape === 'mass' ? 1 : CAVALRY_ASSAULT.frontResistance;
  const resistance = power(target, defender, attacker) * stance;
  return { penetrates: pressure > resistance, pressure: roundedContest(pressure), resistance: roundedContest(resistance) };
}

/** Thresholds below which a recomputed contact edge is the same edge. They
 * are the ones the client already re-plans passes at (CavalryAssaultPresentation),
 * so skipping the write never hides a change the presentation would show (C5). */
export const ASSAULT_GEOMETRY_CHANGE = Object.freeze({position: .5 * FIXED, normalDot: .8});
type AssaultGeometry = Pick<CavalryAssault,'x'|'y'|'nx'|'ny'|'halfWidth'|'depth'|'approach'>;
/** Integer positions and extents, 1e-4 normals: stable, compact snapshot values. */
export function roundedAssaultGeometry<T extends AssaultGeometry>(g:T):T {
  return {...g,x:Math.round(g.x),y:Math.round(g.y),nx:Math.round(g.nx*1e4)/1e4,ny:Math.round(g.ny*1e4)/1e4,
    halfWidth:Math.round(g.halfWidth),depth:Math.round(g.depth),approach:Math.round(g.approach)};
}
/** Three significant figures; these only describe the contest to the client. */
export function roundedContest(n:number):number {return n===0?0:Number(n.toPrecision(3));}
/** True when a recomputed edge differs enough from the stored one to publish. */
export function assaultGeometryChanged(old:AssaultGeometry&{penetrates:boolean},next:AssaultGeometry):boolean {
  return Math.hypot(next.x-old.x,next.y-old.y)>ASSAULT_GEOMETRY_CHANGE.position ||
    next.nx*old.nx+next.ny*old.ny<ASSAULT_GEOMETRY_CHANGE.normalDot ||
    next.depth!==old.depth || next.halfWidth+16<old.halfWidth*.65;
}

/** Rebuilt only on committed attacks, so moving targets and casualty frontage
 * stay current without adding an independent soldier movement simulation. */
export function assaultContactGeometry(source:Squad,target:Squad,tick:number,depth:number,
  certify:(dx:number,dy:number,lateral:number)=>boolean) {
  const n=formationContact(source,target,tick).normal,t={x:-n.y,y:n.x};
  const sourceBody=formationFootprint(source,tick),targetBody=formationFootprint(target,tick);
  const side=(p:{x:number;y:number})=>p.x*t.x+p.y*t.y;
  const lo=Math.max(Math.min(...sourceBody.map(side)),Math.min(...targetBody.map(side))),hi=Math.min(Math.max(...sourceBody.map(side)),Math.max(...targetBody.map(side)));
  const mid=(lo+hi)/2,edge=Math.min(...targetBody.map(p=>p.x*n.x+p.y*n.y));
  const halfWidth=Math.max(0,(hi-lo)/2),approach=Math.min(CAVALRY_ENTRY.maximum,formationEnvelope(source,tick).depth);
  const clear=hi>=lo&&certify(Math.round(n.x*(depth+CONTACT.release)),Math.round(n.y*(depth+CONTACT.release)),Math.min(32,halfWidth));
  return roundedAssaultGeometry({x:n.x*edge+t.x*mid,y:n.y*edge+t.y*mid,nx:n.x,ny:n.y,
    halfWidth:clear?halfWidth:0,depth:clear?depth:0,approach:clear?approach:0});
}

/** The same resistance and terrain certificate govern ordinary assaults and
 * bonus charges. Formation choice belongs to the caller's existing formation. */
export function cavalryAssaultContact(source:Squad,target:Squad,attacker:UnitDefinition,defender:UnitDefinition,tick:number,
  approachStrength:number,certify:(dx:number,dy:number,lateral:number)=>boolean) {
  const resistance=cavalryResistance(source,target,attacker,defender,tick),contact=formationContact(source,target,tick);
  const desired=defender.formationRecipe?.model==='soldiers' && resistance.penetrates
    ?Math.min(CAVALRY_ENTRY.maximum,Math.hypot(target.x-source.x,target.y-source.y)*.6,
      contact.gap+Math.min(formationEnvelope(target,tick).depth*.55,formationEnvelope(source,tick).depth*.6)*(.25+.75*approachStrength)):0;
  const depth=certify(Math.round(contact.normal.x*desired),Math.round(contact.normal.y*desired),0)?desired:0;
  const geometry=assaultContactGeometry(source,target,tick,depth,certify);
  return { ...resistance,geometry,depth:geometry.depth,dx:Math.round(contact.normal.x*geometry.depth),dy:Math.round(contact.normal.y*geometry.depth) };
}

export function ordinaryCavalryAssault(source:Squad,target:Squad,attacker:UnitDefinition,defender:UnitDefinition,tick:number,
  certify:(dx:number,dy:number,lateral:number)=>boolean):CavalryEngagement {
  const contact=cavalryAssaultContact(source,target,attacker,defender,tick,1,certify);
  return {phase:contact.depth>0?'penetrating':'engaged',tick,untilTick:tick+CAVALRY_ENTRY.duration,targetIds:[target.id],
    originX:source.x,originY:source.y,goalX:source.x+contact.dx,goalY:source.y+contact.dy,
    assault:{startTick:tick,bonusUntilTick:tick,strength:0,penetrates:contact.depth>0,...contact.geometry,pressure:contact.pressure,resistance:contact.resistance}};
}

export function assaultBonus(s: Pick<Squad, 'cavalryEngagement'>, tick: number): number {
  const e = s.cavalryEngagement, a = e?.assault;
  return a && e?.phase !== 'withdrawing' && tick < a.bonusUntilTick ? a.strength : 0;
}

export function assaultBonusStart(a:CavalryAssault):number|undefined {
  return a.bonusStartTick ?? (a.bonusUntilTick>a.startTick?a.startTick:undefined);
}

/** Input arms the existing assault rather than creating another impact. The
 * weapon commit starts its clock and spends cooldown exactly once. */
export function armCavalryBonus(s:Squad,unit:UnitDefinition,tick:number):CavalryEngagement|undefined {
  const e=s.cavalryEngagement,a=e?.assault;
  if(!e||!a||e.phase==='withdrawing'||a.pendingBonusStrength!==undefined||tick<a.bonusUntilTick||!unit.charge?.bonusDurationTicks)return undefined;
  const strength=recoveredChargeStrength(s.chargeReadyTick,tick,unit.charge.cooldownTicks);
  return strength>0?{...e,assault:{...a,pendingBonusStrength:strength}}:undefined;
}

export function commitCavalryBonus(s:Squad,unit:UnitDefinition,tick:number):{engagement:CavalryEngagement;readyTick:number}|undefined {
  const e=s.cavalryEngagement,a=e?.assault,strength=a?.pendingBonusStrength,duration=unit.charge?.bonusDurationTicks;
  if(!e||!a||e.phase==='withdrawing'||!strength||!duration)return undefined;
  return {engagement:{...e,assault:{...a,pendingBonusStrength:undefined,bonusStartTick:tick,bonusUntilTick:tick+duration,strength}},readyTick:tick+unit.charge!.cooldownTicks};
}

export function assaultWeapon(profile: AttackProfile, unit: UnitDefinition, strength: number): AttackProfile {
  return strength > 0 ? { ...profile, damage: profile.damage * (1 + ((unit.chargeMultiplier ?? 1) - 1) * strength) } : profile;
}

/** A withdrawal ignores re-acquisition for this long, then ordinary close
 * encounters apply again so a body-blocked rider can fight back (R2-H3, C1). */
export const CAVALRY_WITHDRAW_GUARD_TICKS = secondsToTicks(2);
/** An engagement keeps a target only while the bodies are this close. */
export const CAVALRY_ENGAGEMENT_REACH = CONTACT.release + FIXED;

/** Rank riders remain exposed while coming home; cancelling their attack does
 * not erase them or allow the Move order to be reacquired as another attack
 * during the guard. A rider with nothing in contact and no exposed rank has
 * nothing to withdraw from. */
export function cavalryWithdrawal(s: Squad, tick: number, inContact: (targetId: number) => boolean): CavalryEngagement | undefined {
  const old = s.cavalryEngagement;
  const cycles = [s.cavalryMelee?.current, s.cavalryMelee?.previous].filter(c => !!c);
  const exposed = cycles.filter(c => cavalryRankExposure(c, tick));
  if (!exposed.length && !old?.targetIds.some(inContact)) return undefined;
  const targetIds = [...new Set([...(old?.targetIds ?? []), ...exposed.flatMap(c => c!.contacts.map(p => p.targetId))])].slice(0, 8);
  const withdrawUntilTick = Math.ceil(Math.max(old?.withdrawUntilTick ?? 0, tick + CAVALRY_WITHDRAW_GUARD_TICKS, ...exposed.flatMap(c => [0, 1, 2].filter(rank => cavalryRankExposure(c, tick) & (1 << rank)).map(rank =>
    waveTick(c!, rank) + CAVALRY_RANK_MOTION.brake + CAVALRY_RANK_MOTION.turn * 2 + CAVALRY_RANK_MOTION.return))));
  return { ...(old ?? { tick, untilTick: tick, originX: s.x, originY: s.y, goalX: s.x, goalY: s.y }),
    phase: 'withdrawing', targetIds, withdrawUntilTick,
    ...(old?.assault?{assault:{...old.assault,pendingBonusStrength:undefined}}:{}) };
}
