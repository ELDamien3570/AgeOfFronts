import {TICK_MS} from '../../Protocol';
import { FIXED } from '../../Protocol';
import { CHARGE_IMPACT, type ChargeImpact } from '../../domain/ChargeImpact';
interface Member {id:number;x:number;y:number;angle:number;scale:number}
export interface ChargeReaction {x:number;y:number;angle:number;scale:number;time:number;role:ChargeImpact['role']}
/** A small, deterministic cosmetic cohort; no individual combat state. */
export function chargeReactions(impact:ChargeImpact|undefined,tick:number,members:readonly Member[],selected?:ReadonlySet<number>,rigid=false):Map<number,ChargeReaction> {
  const result=new Map<number,ChargeReaction>();
  if(!impact)return result;
  const elapsed=tick-impact.tick;if(elapsed<0||elapsed>=CHARGE_IMPACT.duration)return result;
  const maximum=impact.participants??CHARGE_IMPACT.maxMembers;
  const nearby=impact.radius===undefined?members:members.filter(m=>Math.hypot(m.x-impact.x/FIXED,m.y-impact.y/FIXED)<=impact.radius!/FIXED);
  const cohort=selected?members.filter(member=>selected.has(member.id)).slice(0,maximum):[...nearby].sort((a,b)=>
    (a.x-impact.x/FIXED)**2+(a.y-impact.y/FIXED)**2-((b.x-impact.x/FIXED)**2+(b.y-impact.y/FIXED)**2)||a.id-b.id)
    .slice(0,Math.min(maximum,impact.participants??Math.max(1,Math.ceil(members.length/3))));
  for(const member of cohort){
    // Stable per-impact variation survives packet timing and render order.
    let seed=(Math.imul(member.id+1,73856093)^Math.imul(impact.sourceId+1,19349663)^impact.tick)>>>0;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const delay=random()*2.5,duration=16+random()*7,weight=.55+random()*.4;
    const lateral=(random()-.5)*.36,spin=(random()-.5)*2.2,peak=.16+random()*.12,settle=.45+random()*.2;
    const p=Math.max(0,Math.min(1,(elapsed-delay)/duration));
    const smooth=(t:number)=>t*t*(3-2*t);
    // Fast impact, independently timed ground slide, then a slower get-up.
    const travel=impact.role==='rider'?(p<.22?1-(1-p/.22)**3:p<.5?1:1-smooth((p-.5)/.5)):p<peak?1-(1-p/peak)**3:p<settle?1-.12*smooth((p-peak)/(settle-peak)):.88*(1-smooth((p-settle)/(1-settle)));
    const flight=impact.role==='defender'?Math.sin(Math.PI*Math.min(1,p/(peak*1.5))):0;
    const length=Math.hypot(impact.dx,impact.dy),sideX=length?-impact.dy/length:0,sideY=length?impact.dx/length:0;
    const carryWeight=impact.role==='rider'?.85+(weight-.55)*.375:weight;
    result.set(member.id,{x:member.x+impact.dx/FIXED*travel*carryWeight,
      y:member.y+impact.dy/FIXED*travel*carryWeight-flight*(.09+weight*.08),
      angle:member.angle+(impact.role==='defender'?Math.sin(Math.PI*p)*spin:0),
      scale:rigid?member.scale:member.scale*(1+flight*.12),time:Math.max(0,elapsed-delay)*TICK_MS,role:impact.role});
    if(impact.role==='defender'){const reaction=result.get(member.id)!;reaction.x+=sideX*length/FIXED*lateral*travel;reaction.y+=sideY*length/FIXED*lateral*travel;}
  }
  return result;
}
