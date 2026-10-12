import { validCombatModifiers } from './CombatFact';
/** Durable, bounded presentation facts. These never participate in damage. */
export interface MeleeStrike {
  tick: number;
  contacts: readonly {
    targetId?: number;
    bearing?: number;
    arc?: import('./FormationFacing').Arc;
    modifiers?: readonly string[];
    damage?: number;
    charge?: boolean;
    fromX: number; fromY: number; toX: number; toY: number;
  }[];
}
export function validateMeleeStrike(value:MeleeStrike|undefined,tick=Infinity):void {
  if(value===undefined)return;
  if(!value || !Number.isSafeInteger(value.tick) || value.tick<0 || value.tick>tick || !Array.isArray(value.contacts) || value.contacts.length<1 || value.contacts.length>8 ||
    value.contacts.some(c=>!c || [c.fromX,c.fromY,c.toX,c.toY].some(n=>!Number.isFinite(n)||Math.abs(n)>2147483647) || c.bearing!==undefined && (!Number.isFinite(c.bearing)||Math.abs(c.bearing)>Math.PI) || c.targetId!==undefined && (!Number.isSafeInteger(c.targetId)||c.targetId<0)))throw Error('Invalid melee strike presentation');
  if(value.contacts.some(c=>c.arc!==undefined&&!['front','flank','rear'].includes(c.arc)||
    c.modifiers!==undefined&&!validCombatModifiers(c.modifiers)||
    c.damage!==undefined&&(!Number.isFinite(c.damage)||c.damage<0)||c.charge!==undefined&&typeof c.charge!=='boolean'))throw Error('Invalid tactical strike facts');
}
