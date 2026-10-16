import { secondsToTicks, TICKS_PER_SECOND } from '../Protocol';
import type { MeleeStrike } from './MeleeStrike';
import { validateMeleeStrike } from './MeleeStrike';
import { formationDoctrine,formationSlots } from './FormationGeometry';
import { CONTACT } from '../content/TacticalRules';
import { FIXED,type Squad } from '../Protocol';
/** Prototype cadence leaves room for a full mounted approach and withdrawal.
 * Damage balance is deliberately deferred until the motion is approved. */
export const CAVALRY_RANK_SPEED=1.5;
export const CAVALRY_RANK_TURN_SPEED=1.5;
export const CAVALRY_RANK_MOTION={cycle:secondsToTicks(16.2/CAVALRY_RANK_SPEED),firstAdvance:1.6*TICKS_PER_SECOND/CAVALRY_RANK_SPEED,
  advance:2*TICKS_PER_SECOND/CAVALRY_RANK_SPEED,brake:.4*TICKS_PER_SECOND/CAVALRY_RANK_SPEED,turn:3*TICKS_PER_SECOND/(CAVALRY_RANK_SPEED*CAVALRY_RANK_TURN_SPEED),return:2*TICKS_PER_SECOND/CAVALRY_RANK_SPEED} as const;
export function validateRankLaunchSpacing(spacing:number):void {
  if(!Number.isFinite(spacing)||spacing<.1||spacing>1)throw Error('Rank launch spacing must be between 10% and 100%');
}
function rankWaveOffset(rank:number,spacing:number):number {
  const m=CAVALRY_RANK_MOTION,stride=m.brake+m.turn+m.advance;
  return Math.max(rank?Math.ceil(m.advance):0,Math.floor(m.firstAdvance+rank*stride*spacing));
}
/** Preview overlap changes launch gaps, never a rider's travel/turn durations.
 * Wait for the final rank to return before casualties can reshuffle cohorts. */
export function cavalryRankCycleTicks(spacing=1):number {
  validateRankLaunchSpacing(spacing);
  if(spacing===1)return CAVALRY_RANK_MOTION.cycle;
  const m=CAVALRY_RANK_MOTION;
  return Math.ceil(rankWaveOffset(2,spacing)+m.brake+m.turn*2+m.return);
}
/** A cosmetic rank lunge bridges this body gap; a committed charge does not. */
export function cavalryUsesRankWaves(source:Squad):boolean {
  if(source.kind!=='cavalry'||!source.formation||source.cavalryEngagement||source.order.type!=='attack'||source.order.cavalryMode!=='ranks')return false;
  const slots=formationSlots(source,source.formation.transition?.startTick??0);
  return slots.some(p=>p.row!==slots[0]?.row);
}
export function cavalryAttackGap(source:Squad,target:Squad):number {
  return cavalryUsesRankWaves(source)&&!source.charge&&target.formation &&
    !formationDoctrine(source.definitionId).hull&&!formationDoctrine(target.definitionId).hull
    ?Math.round(Math.min(FIXED*.5,formationDoctrine(target.definitionId).bodyWidth*1.5)):CONTACT.enter;
}
/** One weapon commitment, paid in three waves. Previous is presentation only. */
export interface CavalryCycle {
  tick:number; interval:number; completed:number; troops:number; orderRevision:number;
  launchSpacing?:number;
  definitionId:string; approachSpeed?:number; rankAxis?:number;rankBand?:number;
  contacts:readonly (MeleeStrike['contacts'][number] & {targetId:number; budget:number; lunge:number;laneWidth?:number;strikeDepth?:number;targetBody?:readonly {x:number;y:number}[];reshape?:number;reachable?:number;rankCounts?:readonly number[]})[];
}
export interface CavalryMelee {current:CavalryCycle; previous?:CavalryCycle}
/** Reserve braking travel inside the terrain-certified lunge envelope. */
export function cavalryStrikeReach(lunge:number,rank:number):number {
  const advance=rank===0?Math.floor(CAVALRY_RANK_MOTION.firstAdvance):CAVALRY_RANK_MOTION.advance;
  return lunge/(1+CAVALRY_RANK_MOTION.brake/advance);
}
/** The squad's own ranks stay ranks at an oblique contact angle. */
export function cavalryRanks(members:readonly {id:number;x:number;y:number}[],axis:number,band:number):Map<number,number> {
  const nx=Math.cos(axis),ny=Math.sin(axis),projection=(p:{x:number;y:number})=>p.x*nx+p.y*ny;
  const ordered=[...members].sort((a,b)=>projection(b)-projection(a)||a.id-b.id);
  const ranks=new Map<number,number>();let row=-1,depth=Infinity;
  for(const p of ordered){const d=projection(p);if(depth-d>band){row++;depth=d;}ranks.set(p.id,Math.min(2,row));}
  return ranks;
}
export function waveTick(c:CavalryCycle,rank:number):number {
  return c.tick+Math.min(c.interval-1,rankWaveOffset(rank,c.launchSpacing??1));
}
/** Contact belongs to advancing riders, not their parked squad body. */
export function cavalryRankExposure(c:CavalryCycle|undefined,tick:number):number {
  if(!c)return 0;
  let mask=0;
  for(let rank=0;rank<3;rank++){
    const elapsed=tick-waveTick(c,rank);
    if(c.contacts.some(p=>!p.rankCounts || p.rankCounts[rank]>0) && elapsed>=-CAVALRY_RANK_MOTION.brake && elapsed<CAVALRY_RANK_MOTION.brake+CAVALRY_RANK_MOTION.turn+CAVALRY_RANK_MOTION.return/2)mask|=1<<rank;
  }
  return mask;
}
export function exposedCavalryContact(s:Squad,targetId:number,tick:number):CavalryCycle['contacts'][number]|undefined {
  if(s.cavalryEngagement && s.cavalryEngagement.phase!=='withdrawing')return undefined;
  for(const cycle of [s.cavalryMelee?.current,s.cavalryMelee?.previous])
    if(cavalryRankExposure(cycle,tick)){const contact=cycle?.contacts.find(p=>p.targetId===targetId&&p.lunge>0);if(contact)return contact;}
  return undefined;
}
export function waveDamage(c:CavalryCycle,budget:number,rank:number,troops:number,counts?:readonly number[]):number {
  const total=counts?.reduce((a,b)=>a+b,0)??3,before=counts?.slice(0,rank).reduce((a,b)=>a+b,0)??rank,after=before+(counts?.[rank]??1);
  const share=total?Math.floor(budget*after/total)-Math.floor(budget*before/total):0;
  return Math.floor(share*Math.min(c.troops,Math.max(0,troops))/c.troops)/1000;
}
export function validateCavalryMelee(value:CavalryMelee|undefined,tick=Infinity):void {
  if(value===undefined)return;
  if(!value||!value.current)throw Error('Invalid cavalry melee cycle');
  for(const c of [value.current,value.previous]){
    if(!c)continue;
    validateMeleeStrike(c,tick);
    if(c.launchSpacing!==undefined){
      validateRankLaunchSpacing(c.launchSpacing);
      if(c.interval<cavalryRankCycleTicks(c.launchSpacing))throw Error('Cavalry rank cycle ends before its riders return');
    }
    if(!Number.isSafeInteger(c.interval)||c.interval<1||c.interval>12000||
      !Number.isSafeInteger(c.completed)||c.completed<0||c.completed>3||
      !Number.isSafeInteger(c.troops)||c.troops<1||c.troops>10000||
      !Number.isSafeInteger(c.orderRevision)||c.orderRevision<0||typeof c.definitionId!=='string'||
      c.approachSpeed!==undefined&&(!Number.isFinite(c.approachSpeed)||c.approachSpeed<0||c.approachSpeed>32)||
      c.rankAxis!==undefined&&(!Number.isFinite(c.rankAxis)||Math.abs(c.rankAxis)>Math.PI*2)||
      c.rankBand!==undefined&&(!Number.isFinite(c.rankBand)||c.rankBand<=0||c.rankBand>512)||
      c.contacts.some(p=>!Number.isSafeInteger(p.targetId)||p.targetId<0||!Number.isSafeInteger(p.budget)||p.budget<0||
        !Number.isFinite(p.lunge)||p.lunge<0||p.lunge>512||p.laneWidth!==undefined&&(!Number.isFinite(p.laneWidth)||p.laneWidth<0||p.laneWidth>64)||
        p.strikeDepth!==undefined&&(!Number.isFinite(p.strikeDepth)||p.strikeDepth<0||p.strikeDepth>128)||
        p.reshape!==undefined&&(!Number.isFinite(p.reshape)||p.reshape<0||p.reshape>64)||
        p.reachable!==undefined&&(!Number.isSafeInteger(p.reachable)||p.reachable<1||p.reachable>c.troops)||
        p.rankCounts!==undefined&&(!Array.isArray(p.rankCounts)||p.rankCounts.length!==3||p.rankCounts.some(n=>!Number.isSafeInteger(n)||n<0)||p.rankCounts.reduce((a,b)=>a+b,0)<1||p.rankCounts.reduce((a,b)=>a+b,0)>c.troops)||
        p.targetBody!==undefined&&(!Array.isArray(p.targetBody)||p.targetBody.length<3||p.targetBody.length>1152||p.targetBody.some(v=>!v||!Number.isSafeInteger(v.x)||!Number.isSafeInteger(v.y)))))throw Error('Invalid cavalry melee cycle');
  }
  if(value.previous && (value.previous.tick>=value.current.tick||value.previous.completed!==3))throw Error('Invalid cavalry melee history');
}
