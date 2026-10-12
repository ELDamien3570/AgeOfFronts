import { FIXED, type Squad } from "../Protocol";
import { LINES } from "../content/TacticalRules";
import type { DeploymentLine, LineDeployment } from "../FormationLine";
import { formationDoctrine, formationEnvelope, type FormationShape } from "./FormationGeometry";
import { eligibleShape, frontageLayout, frontageSummary } from "./FormationProfiles";
import type { ArmySlotRecord } from './Definitions';

export interface BattleLineSlot { point: {x:number;y:number}; shape:FormationShape; frontage?:number }
export interface BattleLineDeployment extends LineDeployment {
  layouts: Map<number,BattleLineSlot>;
  rows:number;
  warnings:string[];
  gesture:DeploymentLine;
}
type LineSquad=Pick<Squad,"id"|"definitionId"|"troops"|"manpower"|"formation"|"charge"|"kind">;
type Member={id:number;origin:{x:number;y:number};squad:LineSquad};
type Option={shape:FormationShape;min:number;preferred:number;max:number;depth:number};
/** Persistent army bands are independent of world heading and gesture deployment. */
export function layoutArmyBattleLine(records:readonly ArmySlotRecord[],crest=false):ArmySlotRecord[] {
  const result=records.map(s=>({...s})),ordered=(role:ArmySlotRecord['role'])=>result.filter(s=>s.role===role).sort((a,b)=>a.index-b.index||a.squadId-b.squadId);
  const maxWidth=LINES.maxFrontTiles*FIXED;
  function band(group:ArmySlotRecord[],front:number,limit:number){
    const rows:ArmySlotRecord[][]=[];let width=0;
    for(const s of group){let row=rows[rows.length-1];if(!row||width+(row.length?LINES.gap:0)+s.width>limit){row=[];rows.push(row);width=0;}width+=s.width+(row.length?LINES.gap:0);row.push(s);}
    let rear=front,used=0;
    for(const row of rows){const width=row.reduce((n,s)=>n+s.width,0)+LINES.gap*(row.length-1),depth=Math.max(...row.map(s=>s.bodyDepth));let x=-width/2;
      for(const s of row){s.lateral=Math.round(x+s.width/2);s.depth=Math.round(rear-depth/2);x+=s.width+LINES.gap;}
      used=Math.max(used,width);rear-=depth+LINES.gap;
    }
    return {rear:rows.length?rear+LINES.gap:front,width:used};
  }
  const frontGroup=ordered('frontline'),frontDepth=Math.max(0,...frontGroup.map(s=>s.bodyDepth));
  const front=band(frontGroup,frontDepth/2,maxWidth),screenWidth=front.width||maxWidth;
  const ranged=band(ordered('ranged'),front.rear-LINES.bandGap,screenWidth);
  const support=band(ordered('support'),ranged.rear-LINES.bandGap,screenWidth);
  band(ordered('reserve'),support.rear-LINES.reserveDepth,screenWidth);
  for(const [role,side] of [['mounted-left',-1],['mounted-right',1]] as const){let edge=front.width/2+LINES.wingGap;
    for(const s of ordered(role)){s.lateral=Math.round(side*(edge+s.width/2));s.depth=0;edge+=s.width+LINES.gap;}}
  if(crest){const rs=ordered("ranged");if(rs.length){const depth=Math.round(rs.reduce((n,s)=>n+s.depth,0)/rs.length);for(const s of result)s.depth-=depth;}}
  return result;
}
function options(s:LineSquad):Option[] {
  const d=formationDoctrine(s.definitionId), current=eligibleShape(s.troops,d,(s.formation?.automatic||s.formation?.autoFrontage?s.formation.deployedShape:s.formation?.shape)??d.defaultShape);
  const shapes=s.formation?.shapeLock?[current]:[...new Set([d.defaultShape,...d.shapes])].filter(shape=>frontageSummary(s.troops,d,shape));
  if(!shapes.length)shapes.push(current);
  return shapes.map(shape=>{
    const p=frontageSummary(s.troops,d,shape);
    if(p)return {shape,min:frontageLayout(s.troops,d,shape,p.narrow.minWidth)!.width,preferred:p.preferred.preferredWidth,max:frontageLayout(s.troops,d,shape,p.wide.maxWidth)!.width,depth:p.preferred.depth};
    const e=formationEnvelope({...s,formation:{...s.formation!,shape,transition:undefined,trail:undefined,frontage:undefined}},0);
    return {shape,min:e.width,preferred:e.width,max:e.width,depth:e.depth};
  });
}
/** Shared preview/authority calculation. No pathing, terrain tests or mutation. */
export function layoutBattleLine(members:readonly Member[],gesture:DeploymentLine):BattleLineDeployment|undefined {
  const dx=gesture.end.x-gesture.start.x,dy=gesture.end.y-gesture.start.y,length=Math.hypot(dx,dy);
  if(!members.length || !Number.isFinite(length)||length<1)return undefined;
  const ux=dx/length,uy=dy/length,center={x:(gesture.start.x+gesture.end.x)/2,y:(gesture.start.y+gesture.end.y)/2};
  const rawFacing=Math.atan2(-ux,uy)-Math.PI/2,facing=Math.round(Math.atan2(Math.sin(rawFacing),Math.cos(rawFacing))*1e6)/1e6;
  const choices=new Map(members.map(m=>[m.id,options(m.squad)]));
  const narrow=(m:Member)=>Math.min(...choices.get(m.id)!.map(o=>o.min));
  // Keep melee at the front; displace ranged troops first and highest IDs on ties.
  const priority=[...members].sort((a,b)=>Number(a.squad.kind==='archer')-Number(b.squad.kind==='archer')||a.id-b.id);
  const rows:Member[][]=[]; let used=0;
  for(const m of priority){let row=rows[rows.length-1];if(!row || used+LINES.gap+narrow(m)>length){row=[];rows.push(row);used=0;}used+=narrow(m)+(row.length?LINES.gap:0);row.push(m);}
  const slots=new Map<number,{x:number;y:number}>(),layouts=new Map<number,BattleLineSlot>(),warnings=new Set<string>();
  if(rows.length>1)warnings.add('Wrapped row');
  let depthOffset=0,maxUsed=0;
  for(const row of rows){
    row.sort((a,b)=>(a.origin.x-b.origin.x)*ux+(a.origin.y-b.origin.y)*uy||a.id-b.id);
    const usable=Math.max(0,length-(row.length-1)*LINES.gap);
    const preferred=row.map(m=>{const os=choices.get(m.id)!;return (os.find(o=>o.shape===(m.squad.formation?.automatic||m.squad.formation?.autoFrontage?m.squad.formation.deployedShape:m.squad.formation?.shape))??os[0]).preferred;});
    const sum=preferred.reduce((a,b)=>a+b,0);let requests=preferred.map(w=>w*usable/sum);
    const choose=(m:Member,request:number)=>{
      const os=choices.get(m.id)!,current=m.squad.formation?.deployedShape??m.squad.formation?.shape;
      const retained=os.find(o=>o.shape===current && request>=o.min*.95 && request<=o.max*1.05);
      const ranked=retained?[retained]:os;
      let best: {shape:FormationShape;width:number;depth:number;frontage?:number}|undefined,error=Infinity;
      for(const o of ranked){const p=frontageLayout(m.squad.troops,formationDoctrine(m.squad.definitionId),o.shape,request),width=p?.width??o.min;
        const distance=Math.abs(width-request);
        if(distance<error){error=distance;best={shape:o.shape,width,depth:p?.depth??o.depth,frontage:p?.width};}
        if(distance<=FIXED*.05)break;
      }return best!;
    };
    let selected=row.map((m,i)=>choose(m,requests[i]));
    for(let pass=0;pass<3;pass++){
      const remainder=usable-selected.reduce((n,s)=>n+s.width,0);
      if(Math.abs(remainder)<16)break;
      const adjustable=row.map((m,i)=>({m,i})).filter(({m,i})=>remainder>0?selected[i].width<Math.max(...choices.get(m.id)!.map(o=>o.max)):selected[i].width>narrow(m));
      if(!adjustable.length)break;
      for(const {m,i} of adjustable.sort((a,b)=>a.m.id-b.m.id)){requests[i]=selected[i].width+remainder/adjustable.length;selected[i]=choose(m,requests[i]);}
    }
    // Quantisation/disjoint intervals can overshoot: project down in stable ID order.
    for(const {m,i} of row.map((m,i)=>({m,i})).sort((a,b)=>b.m.id-a.m.id)){
      const excess=selected.reduce((n,s)=>n+s.width,0)-usable;if(excess<=0)break;
      selected[i]=choose(m,Math.max(narrow(m),selected[i].width-excess-16));
      warnings.add('Nearest fit');
    }
    const total=selected.reduce((n,s)=>n+s.width,0),gap=row.length>1?Math.max(LINES.gap,Math.min(LINES.maxGap,(length-total)/(row.length-1))):0;
    const width=total+gap*(row.length-1);maxUsed=Math.max(maxUsed,width);
    if(total<usable-16)warnings.add('At maximum width');
    let cursor=-width/2;
    row.forEach((m,i)=>{const s=selected[i],lateral=cursor+s.width/2,point={x:Math.round(center.x+ux*lateral-uy*depthOffset),y:Math.round(center.y+uy*lateral+ux*depthOffset)};
      slots.set(m.id,point);layouts.set(m.id,{point,shape:s.shape,frontage:s.frontage});cursor+=s.width+gap;
    });
    depthOffset+=Math.max(...selected.map(s=>s.depth))+LINES.rowGap;
  }
  return {facing,slots,layouts,rows:rows.length,warnings:[...warnings],gesture,start:{x:Math.round(center.x-ux*maxUsed/2),y:Math.round(center.y-uy*maxUsed/2)},end:{x:Math.round(center.x+ux*maxUsed/2),y:Math.round(center.y+uy*maxUsed/2)}};
}
