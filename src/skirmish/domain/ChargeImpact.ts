/** Bounded prototype impact: roots remain authoritative, offsets are cosmetic. */
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
export const CHARGE_IMPACT = Object.freeze({duration:24,disruption:8,maxOffset:160,maxRiderOffset:256,maxMembers:8});
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
