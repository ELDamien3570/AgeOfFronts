import type { Arc } from './FormationFacing';
export const COMBAT_MODIFIER_LIMIT = 6;
export const COMBAT_MODIFIER_LENGTH = 32;
export function validCombatModifiers(value:unknown):value is readonly string[] {
  return Array.isArray(value)&&value.length<=COMBAT_MODIFIER_LIMIT&&
    value.every(m=>typeof m==='string'&&m.length<=COMBAT_MODIFIER_LENGTH);
}
/** Latest committed attack explanation. Presentation and AI never drive damage through it. */
export interface CombatFact {
  tick:number; sourceId:number; targetId:number;
  channel:'melee'|'ranged'; arc:Arc;
  damage:number; charge:boolean; modifiers:readonly string[];
}
export function validateCombatFact(f:CombatFact|undefined,tick=Infinity):void {
  if(f===undefined)return;
  if(!f||![f.tick,f.sourceId,f.targetId].every(n=>Number.isSafeInteger(n)&&n>=0)||f.tick>tick||
    !['melee','ranged'].includes(f.channel)||!['front','flank','rear'].includes(f.arc)||
    !Number.isFinite(f.damage)||f.damage<0||typeof f.charge!=='boolean'||!validCombatModifiers(f.modifiers))throw Error('Invalid combat explanation');
}
