import type { ChargeState } from './Definitions';
import type { Squad } from '../Protocol';
export function movingCavalryRush(s:Pick<Squad,'kind'|'charge'>):boolean {
  return s.kind==='cavalry' && !!s.charge && s.charge.phase!=='recovery';
}
export function movingFormationReform(s:Pick<Squad,'kind'|'charge'|'formation'>):boolean {
  return movingCavalryRush(s) || s.formation?.transition?.reorientation===true;
}

/** Captured when a rush starts. Retargeting an active run preserves its budget. */
export function recoveredChargeStrength(readyTick:number|undefined,tick:number,cooldown:number):number {
  return 1-Math.min(1,Math.max(0,(readyTick??0)-tick)/Math.max(1,cooldown));
}
export function chargeStrength(charge:ChargeState):number { return charge.strength??1; }
export function validateChargeStrength(strength:number|undefined):void {
  if(strength!==undefined && (!Number.isFinite(strength)||strength<0||strength>1))throw Error('Invalid charge strength');
}
