import type {DiplomacyState} from './Definitions';
/** Validate new authority at import/transport boundaries, not on every query. */
export function validateRaidDiplomacy(state:DiplomacyState):void {
  const id=(n:number)=>Number.isSafeInteger(n)&&n>0&&n<255;
  const tick=(n:number)=>Number.isSafeInteger(n)&&n>=0;
  const check=(rows:readonly unknown[],key:(row:any)=>string,valid:(row:any)=>boolean)=>{
    if(!Array.isArray(rows)||rows.length>254*253)throw Error('Invalid diplomacy records');
    const keys=new Set<string>();for(const r of rows){if(!r||!valid(r)||keys.has(key(r)))throw Error('Invalid diplomacy record');keys.add(key(r));}
  };
  check(state.embargoes??[],r=>`${r.initiator}:${r.victim}`,r=>id(r.initiator)&&id(r.victim)&&r.initiator!==r.victim&&tick(r.lastTheftTick));
  check(state.peaceProtection??[],r=>`${Math.min(r.a,r.b)}:${Math.max(r.a,r.b)}`,r=>id(r.a)&&id(r.b)&&r.a!==r.b&&tick(r.untilTick));
  check(state.dontEmbargo??[],r=>`${r.playerId}:${r.otherId}`,r=>id(r.playerId)&&id(r.otherId)&&r.playerId!==r.otherId);
  check(state.wars??[],r=>`${Math.min(r.a,r.b)}:${Math.max(r.a,r.b)}`,r=>id(r.a)&&id(r.b)&&r.a!==r.b&&(r.initiator===undefined||r.initiator===r.a||r.initiator===r.b)&&(r.startedTick===undefined||tick(r.startedTick))&&(r.cause===undefined||['declaration','entry','invasion'].includes(r.cause)));
  if(state.offers.some(o=>o.kind!==undefined&&o.kind!=='peace'))throw Error('Invalid diplomacy offer');
}
