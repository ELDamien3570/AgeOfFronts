import {formationEnvelope,facingOf} from './FormationGeometry';
import type {FormationBody} from './FormationContact';
import {FACING} from '../content/TacticalRules';
export type Arc='front'|'flank'|'rear';
export function formationForward(s:FormationBody,tick:number){const a=formationEnvelope(s,tick).angle;return {x:-Math.sin(a),y:Math.cos(a)};}
export function armyFacingToFormation(a:number){return facingOf(a-Math.PI/2);}
export function facingArc(s:FormationBody,from:{x:number;y:number},tick:number):Arc {
  const shape=formationEnvelope(s,tick).shape;
  if(shape==='square'||shape==='modern-loose')return 'front';
  const f=formationForward(s,tick),x=from.x-s.x,y=from.y-s.y,length=Math.hypot(x,y);
  if(!length)return 'front';
  const c=(f.x*x+f.y*y)/length,threshold=shape==='column'?FACING.columnCos:FACING.frontCos;
  return c>=threshold?'front':c<=-threshold?'rear':'flank';
}
