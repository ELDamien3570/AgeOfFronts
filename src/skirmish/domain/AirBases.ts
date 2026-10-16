import { FIXED, type Building, type Ship } from '../Protocol';
import { VESSEL } from '../content/Units';
import { AIRCRAFT_RULES } from '../content/ModernWeapons';
import type { Age } from './Definitions';

export interface AirBase {
  id:number; playerId:number; x:number; y:number; tile:number; age:Age;
  capacity:number; kind:'airstrip'|'drone-facility'|'carrier';
}
export function airBases(buildings:readonly Building[],ships:readonly Pick<Ship,'id'|'playerId'|'kind'|'health'|'refit'|'x'|'y'|'definitionId'>[],width:number,owners?:Uint8Array):AirBase[] {
  const result:AirBase[]=[];
  for(const b of buildings) if((b.type==='airstrip'||b.type==='drone-facility') && !b.remainingTicks && (b.health??1)>0 && (!owners||owners[b.tile]===b.playerId))
    result.push({id:b.id,playerId:b.playerId,x:((b.tile%width)+.5)*FIXED,y:(Math.floor(b.tile/width)+.5)*FIXED,tile:b.tile,age:b.age??'EarlyModern',capacity:AIRCRAFT_RULES.airfieldCapacity,kind:b.type});
  for(const s of ships) if(s.kind==='carrier' && s.health>0 && !s.refit) result.push({id:s.id,playerId:s.playerId,x:s.x,y:s.y,tile:Math.floor(s.y/FIXED)*width+Math.floor(s.x/FIXED),age:VESSEL.get(s.definitionId??'')?.age??'EarlyModern',capacity:AIRCRAFT_RULES.airfieldCapacity,kind:'carrier'});
  return result;
}
export const baseAccepts = (base:AirBase,kind:'fighter'|'bomber'|'drone') => kind==='drone'?base.kind==='drone-facility':base.kind!=='drone-facility';
