import { secondsToTicks } from '../Protocol';
import type { Squad } from '../Protocol';
import type { CavalryAssault } from './CavalryAssault';
export const CAVALRY_ENTRY = Object.freeze({maximum:384,duration:secondsToTicks(2),corridor:64});
export interface CavalryEngagement {
  phase:'penetrating'|'engaged'|'withdrawing';
  tick:number;untilTick:number;
  targetIds:readonly number[];
  originX:number;originY:number;goalX:number;goalY:number;
  assault?: CavalryAssault;
  withdrawUntilTick?: number;
}
export function validateCavalryEngagement(v:CavalryEngagement|undefined,tick=Infinity):void {
  if(v===undefined)return;
  if(!v||!['penetrating','engaged','withdrawing'].includes(v.phase)||!Number.isSafeInteger(v.tick)||v.tick<0||v.tick>tick||
    !Number.isSafeInteger(v.untilTick)||v.untilTick<v.tick||v.untilTick>v.tick+CAVALRY_ENTRY.duration||
    !Array.isArray(v.targetIds)||v.targetIds.length>8||new Set(v.targetIds).size!==v.targetIds.length||v.targetIds.some(id=>!Number.isSafeInteger(id)||id<0)||
    [v.originX,v.originY,v.goalX,v.goalY].some(n=>!Number.isFinite(n)||Math.abs(n)>2147483647)||
    Math.hypot(v.goalX-v.originX,v.goalY-v.originY)>CAVALRY_ENTRY.maximum+1)throw Error('Invalid cavalry engagement');
  if(v.withdrawUntilTick!==undefined && (!Number.isSafeInteger(v.withdrawUntilTick)||v.withdrawUntilTick<0||v.withdrawUntilTick>tick+secondsToTicks(16)))throw Error('Invalid cavalry withdrawal');
  const a=v.assault;
  if(!a)return;
  const bonusStart=a.bonusStartTick??a.startTick;
  if(!Number.isSafeInteger(a.startTick)||a.startTick<0||a.startTick>tick||!Number.isSafeInteger(a.bonusUntilTick)||a.bonusUntilTick<bonusStart||a.bonusUntilTick>bonusStart+secondsToTicks(120)||
    (a.bonusStartTick!==undefined&&(!Number.isSafeInteger(a.bonusStartTick)||a.bonusStartTick<a.startTick||a.bonusStartTick>tick))||
    (a.pendingBonusStrength!==undefined&&(!Number.isFinite(a.pendingBonusStrength)||a.pendingBonusStrength<=0||a.pendingBonusStrength>1||tick<a.bonusUntilTick))||
    !Number.isFinite(a.strength)||a.strength<0||a.strength>1||typeof a.penetrates!=='boolean'||
    [a.x,a.y,a.nx,a.ny,a.halfWidth,a.depth,a.approach,a.pressure,a.resistance].some(n=>!Number.isFinite(n)||Math.abs(n)>2147483647)||
    Math.abs(Math.hypot(a.nx,a.ny)-1)>.001||a.halfWidth<0||a.depth<0||a.depth>CAVALRY_ENTRY.maximum||a.approach<0||a.approach>CAVALRY_ENTRY.maximum||a.pressure<0||a.resistance<0||!a.penetrates&&a.depth>0)throw Error('Invalid cavalry assault');
}
/** The caller still certifies terrain/walls and every unrelated hostile body. */
export function cavalryOverlapAllowed(s:Squad,other:Squad,end:{x:number;y:number},tick:number,alreadyOverlapping:boolean):boolean {
  const e=s.cavalryEngagement;
  if(s.kind!=='cavalry'||!e||!e.targetIds.includes(other.id)||!['infantry','archer','cavalry'].includes(other.kind)||other.manpower?.model!=='soldiers'||other.afloat||other.embarkedOn!==null)return false;
  if(e.phase==='withdrawing')return alreadyOverlapping;
  if(e.phase!=='penetrating'||tick>e.untilTick)return false;
  const dx=e.goalX-e.originX,dy=e.goalY-e.originY,length=Math.hypot(dx,dy);
  if(!length)return false;
  const forward=((end.x-e.originX)*dx+(end.y-e.originY)*dy)/length;
  const current=((s.x-e.originX)*dx+(s.y-e.originY)*dy)/length;
  const lateral=Math.abs((end.x-e.originX)*dy-(end.y-e.originY)*dx)/length;
  return forward>=current-1 && forward<=length+1 && lateral<=CAVALRY_ENTRY.corridor;
}
