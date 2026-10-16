import { FIXED } from '../Protocol';
import type { Aircraft } from '../domain/Definitions';

export const DRONE_SWARM = {size:20,health:100,spread:1.5*FIXED,areaRadius:4*FIXED,damageDenominator:60} as const;
/** A prepared swarm and its live members consume one recruitment/capacity slot. */
export function aircraftSlots(aircraft:readonly Aircraft[],playerId?:number):number {
  const ids=new Set<number>();
  for(const a of aircraft) if(a.health>0 && (playerId===undefined||a.playerId===playerId)) ids.add(a.drone?.swarmId??a.id);
  return ids.size;
}
const offsets=Array.from({length:DRONE_SWARM.size},(_,index)=>{
  const angle=index*2.399963229728653, radius=DRONE_SWARM.spread*Math.sqrt((index+.5)/DRONE_SWARM.size);
  return Object.freeze({x:Math.round(Math.cos(angle)*radius),y:Math.round(Math.sin(angle)*radius)});
});
export const droneOffset=(index:number):Readonly<{x:number;y:number}>=>offsets[index];
/** Integer shares sum to exactly one third over twenty impacts; interception removes that member's share. */
export const droneDamageShare=(maximum:number,index:number)=>Math.floor(maximum*(index+1)/DRONE_SWARM.damageDenominator)-Math.floor(maximum*index/DRONE_SWARM.damageDenominator);
