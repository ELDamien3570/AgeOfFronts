/** Durable, bounded presentation facts. These never participate in damage. */
export interface MeleeStrike {
  tick: number;
  contacts: readonly {
    targetId?: number;
    bearing?: number;
    fromX: number; fromY: number; toX: number; toY: number;
  }[];
}
export function validateMeleeStrike(value:MeleeStrike|undefined,tick=Infinity):void {
  if(value===undefined)return;
  if(!value || !Number.isSafeInteger(value.tick) || value.tick<0 || value.tick>tick || !Array.isArray(value.contacts) || value.contacts.length<1 || value.contacts.length>8 ||
    value.contacts.some(c=>!c || [c.fromX,c.fromY,c.toX,c.toY].some(n=>!Number.isFinite(n)||Math.abs(n)>2147483647) || c.bearing!==undefined && (!Number.isFinite(c.bearing)||Math.abs(c.bearing)>Math.PI) || c.targetId!==undefined && (!Number.isSafeInteger(c.targetId)||c.targetId<0)))throw Error('Invalid melee strike presentation');
}
