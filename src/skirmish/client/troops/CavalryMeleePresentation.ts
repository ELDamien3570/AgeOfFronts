import {TICK_MS,TICKS_PER_SECOND} from '../../Protocol';
import { FIXED } from '../../Protocol';
import type { CavalryCycle,CavalryMelee } from '../../domain/CavalryMelee';
import { waveTick,cavalryRanks,cavalryStrikeReach,CAVALRY_RANK_MOTION,CAVALRY_RANK_SPEED } from '../../domain/CavalryMelee';
import type { ActorClip } from './TroopFormationModel';
import { contactPath } from '../../domain/ContactFront';
type Member={id:number;x:number;y:number;scale:number};
const RANK_PEAK_SPEED=1.5*CAVALRY_RANK_SPEED/TICKS_PER_SECOND; // Tiles per tick; independent of sprite-sheet scale.
export interface CavalryCohort extends Map<number,{rank:number;contact:number;travel:number;lane:number;returnLane:number;bearing?:number}>{maximum:number}
const smooth=(n:number)=>{const t=Math.max(0,Math.min(1,n));return t*t*(3-2*t);};
/** Integrate smooth acceleration ramps around a steady-speed middle. The
 * normalized peak is 1.25, rather than the quintic curve's 1.875. */
function returnTravel(u:number){
  const ramp=.2,area=1-ramp;
  if(u<ramp){const t=u/ramp;return {progress:ramp*(t*t*t-t*t*t*t/2)/area,speed:smooth(t)/area};}
  if(u>1-ramp){const t=(1-u)/ramp;return {progress:1-ramp*(t*t*t-t*t*t*t/2)/area,speed:smooth(t)/area};}
  return {progress:(u-ramp/2)/area,speed:1/area};
}
/** Continuous position and velocity at strike, braking, return and arrival.
 * The strike is peak forward speed, followed by recovery and a curved return.
 * Cadence bounds travel, never forces a fast catch-up or stationary spin. */
export function rankMotion(distance:number,elapsed:number,advance:number,turn:number,back:number,settle=Math.min(.4*TICKS_PER_SECOND,back*.25),entrySpeed=0,brakeTicks=.4*TICKS_PER_SECOND){
  if(elapsed < -advance-1e-9 || elapsed>=turn+back)return undefined;
  const brake=Math.min(brakeTicks,turn*.4),basePeak=Math.min(RANK_PEAK_SPEED,2*distance/(advance+brake));
  const initial=Math.min(entrySpeed,basePeak*.4),peak=Math.min(RANK_PEAK_SPEED,(2*distance-initial*advance)/(advance+brake));
  const acceleration=(peak-initial)/advance,atStrike=(initial+peak)*advance/2,reached=atStrike+peak*brake/2;
  if(elapsed<0){const t=Math.max(0,elapsed+advance),forward=initial*t+acceleration*t*t/2;return {forward,rotation:0,returning:false,progress:0,reached,speed:initial+acceleration*t,gait:forward};}
  if(elapsed<turn){
    const t=Math.min(elapsed,brake),forward=atStrike+peak*t-peak*t*t/(2*brake);
    return {forward,rotation:0,returning:false,progress:0,reached,
      speed:elapsed<brake?peak*(1-t/brake):0,gait:forward};
  }
  const travelTime=back-settle,u=Math.min(1,(elapsed-turn)/travelTime);
  const travel=returnTravel(u),progress=travel.progress,forward=reached*(1-progress);
  return {forward,rotation:0,returning:true,progress,reached,settling:smooth((elapsed-turn-travelTime)/settle),
    speed:reached*travel.speed/travelTime,gait:reached*(1+progress)};
}
function rankTiming(interval:number){
  const advance=Math.min(CAVALRY_RANK_MOTION.advance,interval/3);
  const turn=CAVALRY_RANK_MOTION.brake+CAVALRY_RANK_MOTION.turn;
  const settle=CAVALRY_RANK_MOTION.turn,back=CAVALRY_RANK_MOTION.return+settle;
  return {advance,turn,back,settle};
}
/** Freeze identity and gap lanes once per commitment. No per-frame neighbor search. */
export function cavalryCohort(c:CavalryCycle,members:readonly Member[]):CavalryCohort {
  const result:CavalryCohort=Object.assign(new Map(),{maximum:.001}),assigned=c.contacts.map(()=>[] as Member[]);
  const canonicalRanks=c.rankAxis!==undefined && c.rankBand!==undefined?cavalryRanks(members,c.rankAxis,c.rankBand/FIXED):undefined;
  for(const member of members){
    let best=0,distance=Infinity;
    c.contacts.forEach((p,i)=>{const d=Math.hypot(member.x-p.fromX/FIXED,member.y-p.fromY/FIXED);if(d<distance){distance=d;best=i;}});
    assigned[best]?.push(member);
  }
  assigned.forEach((group,contact)=>{
    const bearing=c.contacts[contact].bearing??Math.PI/2,nx=Math.cos(bearing),ny=Math.sin(bearing);
    const projection=(m:Member)=>m.x*nx+m.y*ny,across=(m:Member)=>-m.x*ny+m.y*nx;
    group.sort((a,b)=>projection(b)-projection(a)||a.id-b.id);
    const p=c.contacts[contact];
    const strike=(p.toX*nx+p.toY*ny+(p.strikeDepth??0))/FIXED,width=Math.min(16,p.laneWidth??0)/FIXED;
    // Peak speed occurs at the strike; reserve the extra stopping distance
    // after it without mistaking the source body's edge for a rider's position.
    let row=-1,depth=Infinity;
    const pitch=Math.max(.04,...group.map(s=>s.scale*.4));
    for(const member of group){const d=projection(member);if(depth-d>pitch){row++;depth=d;}
      const rank=canonicalRanks?.get(member.id)??Math.min(2,row),advance=Math.min(rank===0?CAVALRY_RANK_MOTION.firstAdvance:CAVALRY_RANK_MOTION.advance,waveTick(c,rank)-c.tick);
      const stopScale=(advance+CAVALRY_RANK_MOTION.brake)/Math.max(1,advance);
      const path=p.targetBody?contactPath({x:member.x*FIXED,y:member.y*FIXED},p.targetBody,bearing,cavalryStrikeReach(p.lunge,rank),p.reshape??0,p.strikeDepth??0):undefined;
      const travel=p.targetBody?(path?path.distance/FIXED*stopScale:0):Math.min(p.lunge/FIXED,Math.max(0,strike-d)*stopScale);result.maximum=Math.max(result.maximum,travel);
      result.set(member.id,{rank,contact,travel,lane:0,returnLane:0,bearing:path?.bearing});}
    const rows=[0,1,2].map(rank=>group.filter(m=>result.get(m.id)!.rank===rank).sort((a,b)=>across(a)-across(b)||a.id-b.id));
    const gaps=rows.map(ahead=>ahead.length>1?ahead.slice(1).map((m,i)=>(across(m)+across(ahead[i]))/2):ahead.flatMap(m=>[across(m)-pitch,across(m)+pitch]));
    for(const member of group){
      const assignment=result.get(member.id)!;
      let lane=0,distance=Infinity;
      if(assignment.rank>0){
        // Midpoints of the preceding rank are cheap, stable passing lanes.
        const lanes=gaps[assignment.rank-1],x=across(member);let lo=0,hi=lanes.length;
        while(lo<hi){const mid=(lo+hi)>>>1;if(lanes[mid]<x)lo=mid+1;else hi=mid;}
        for(const i of [lo-1,lo]){if(i<0||i>=lanes.length)continue;const delta=lanes[i]-x;if(Math.abs(delta)<distance){distance=Math.abs(delta);lane=delta;}}
      }
      const passingLane=width?Math.max(-width,Math.min(width,lane)):0;
      const shiftedPath=p.targetBody?contactPath({x:(member.x-ny*passingLane)*FIXED,y:(member.y+nx*passingLane)*FIXED},p.targetBody,bearing,p.lunge,0,p.strikeDepth??0):undefined;
      assignment.lane=!p.targetBody || shiftedPath && Math.abs((assignment.bearing??bearing)-bearing)<.001?passingLane:0;
      // Returning riders peel to one side of their own files while incoming
      // riders pass between files. This remains a bounded cosmetic path.
      assignment.returnLane=Math.min(Math.max(0,width-Math.abs(assignment.lane)),pitch*.45);
    }
  });
  return result;
}
export function cavalryWaves(state:CavalryMelee|undefined,tick:number,clip:ActorClip,members:readonly Member[],cohorts:ReadonlyMap<number,CavalryCohort>){
  const result=new Map<number,{x:number;y:number;angle:number;time:number;attacking:boolean;moving:boolean;gaitDistance:number}>();
  if(!state)return result;
  const frames=clip.durations??Array(clip.frameCount).fill(1000/(clip.fps??6));
  const release=frames.slice(0,clip.releaseFrame??0).reduce((a,b)=>a+b,0),duration=frames.reduce((a,b)=>a+b,0);
  const previousTiming=state.previous?rankTiming(state.previous.interval):undefined;
  for(const c of [state.previous,state.current]){
    if(!c)continue;
    const cohort=cohorts.get(c.tick);if(!cohort)continue;
    // The shared commitment cadence reserves time for both full turns.
    const {advance,turn,back,settle}=rankTiming(c.interval);
    for(const member of members){
      const assignment=cohort.get(member.id);if(!assignment)continue;
      const {rank,contact,travel,lane,returnLane}=assignment,p=c.contacts[contact],hit=waveTick(c,rank);
      if(p.targetBody && !travel)continue;
      if(c===state.current && state.previous && previousTiming){
        const previous=cohorts.get(state.previous.tick)?.get(member.id);
        // Casualties can promote a returning rider into the next front rank.
        // Let that return finish; skip its conflicting cosmetic wave instead
        // of replacing a live trajectory halfway through. Damage is unaffected.
        if(previous && Math.max(c.tick,hit-advance)<waveTick(state.previous,previous.rank)+previousTiming.turn+previousTiming.back)continue;
      }
      const elapsed=tick-hit;
      const tripAdvance=Math.min(rank===0?CAVALRY_RANK_MOTION.firstAdvance:advance,Math.max(.001,hit-c.tick));
      const motion=rankMotion(travel,elapsed,tripAdvance,turn,back,settle,rank===0?(c.approachSpeed??0)*CAVALRY_RANK_SPEED/FIXED:0,CAVALRY_RANK_MOTION.brake);
      if(!motion)continue;
      const {forward,returning,progress,reached}=motion;
      // Keep the passing gap through the strike, then curve back to the rider's
      // own slot. Returning to its original file at impact would cross the front.
      const returnOffset=Math.min(returnLane,reached*.1);
      const bend=returning?lane*smooth((travel?reached/travel:0)/.25)*(1-progress)+returnOffset*Math.sin(Math.PI*progress):lane*smooth((travel?forward/travel:0)/.25);
      let rotation=0;
      if(elapsed>=CAVALRY_RANK_MOTION.brake && reached>=Math.max(.18,member.scale*.6)){
        // Complete a slow half-turn before riding home, then face the enemy
        // after arriving. Shared speed tuning scales both complete turns.
        const advanceLane=lane*smooth((travel?reached/travel:0)/.25);
        const initialSide=-advanceLane+returnOffset*Math.PI;
        const heading=(initialSide<0?-1:1)*Math.PI;
        rotation=returning?heading*(1-(motion.settling??0)):heading*smooth((elapsed-CAVALRY_RANK_MOTION.brake)/CAVALRY_RANK_MOTION.turn);
      }
      const bearing=assignment.bearing??p.bearing??Math.PI/2,time=release+(tick-hit)*TICK_MS;
      result.set(member.id,{x:member.x+Math.cos(bearing)*forward-Math.sin(bearing)*bend,
        y:member.y+Math.sin(bearing)*forward+Math.cos(bearing)*bend,
        angle:bearing-Math.PI/2+rotation,time:Math.max(0,time),
        attacking:!returning&&tick>=hit&&time>=0&&time<duration,moving:motion.speed>.00001,gaitDistance:motion.gait});
    }
  }
  return result;
}
