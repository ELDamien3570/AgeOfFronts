import {FACING,SHAPES} from '../content/TacticalRules';
import {formationEnvelope,formationDoctrine,type FormationShape} from './FormationGeometry';
import {facingArc,type Arc} from './FormationFacing';
import {formationContact} from './FormationContact';
import type {Squad} from '../Protocol';
import type {Defence} from './Combat';
export function formationModifiers(shape:FormationShape,deployed:boolean,channel:'melee'|'ranged',arc:Arc,mounted:boolean,charge=false){
  let bp=channel==='melee'?FACING.exposure[arc]:10000;
  const modifiers:string[]=[];
  if(channel==='melee'&&shape==='mass')bp=10000+(bp-10000)/2;
  if(channel==='melee'&&(shape==='square'||shape==='modern-loose'))bp=10000;
  if(bp!==10000)modifiers.push(`${arc}+${(bp-10000)/100}%`);
  let protection=10000;
  if(deployed){
    if(shape==='shield-wall'&&arc==='front'){protection=channel==='ranged'?SHAPES.shieldRanged:SHAPES.shieldMelee;modifiers.push(channel==='ranged'?'shield-front ranged -35%':'shield-front melee -15%');}
    if(shape==='square'){
      if(channel==='ranged'){protection=SHAPES.squareRanged;modifiers.push('square ranged +25%');}
      else if(mounted){protection=charge?SHAPES.squareCharge:SHAPES.squareMounted;modifiers.push(charge?'square charge -60%':'square mounted -25%');}
    }
    if(shape==='modern-loose'&&channel==='ranged'){protection=SHAPES.looseRanged;modifiers.push('loose ranged -20%');}
  }
  return {arc,bp:Math.round(bp*protection/10000),modifiers};
}
export function tacticalFacts(a:Squad,b:Squad,tick:number,channel:'melee'|'ranged',charge=false){
  if(!b.formation||b.afloat)return {arc:'front' as Arc,bp:10000,modifiers:[] as string[]};
  const from=channel==='melee'&&a.formation?formationContact(a,b,tick).source:a;
  const shape=formationEnvelope(b,tick).shape;
  const facts=formationModifiers(shape,!b.formation.transition&&shape!=='column',channel,facingArc(b,from,tick),formationDoctrine(a.definitionId).mounted,charge);
  if(channel==='ranged'&&a.formation){
    const own=formationEnvelope(a,tick).shape;
    if(own==='column')facts.modifiers.push('column: two firing ranks');
    else if(own!=='line'||a.formation.transition)facts.modifiers.push('non-line firing ranks 75%');
  }
  return facts;
}
export function tacticalDefence(a:Squad,b:Squad,tick:number,channel:'melee'|'ranged',defence:Defence,charge=false):Defence {
  return {...defence,tacticalBp:tacticalFacts(a,b,tick,channel,charge).bp};
}
export function shapeSpeedBp(s:Squad,tick:number){
  if(!s.formation||s.formation.transition||s.afloat)return 10000;
  const shape=formationEnvelope(s,tick).shape;
  return shape==='shield-wall'?SHAPES.shieldSpeed:shape==='square'?SHAPES.squareSpeed:10000;
}
