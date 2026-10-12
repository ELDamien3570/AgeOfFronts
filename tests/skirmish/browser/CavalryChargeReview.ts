import { hybridCombatScene } from '../fixtures/HybridCombat';
import { trenchFrontage } from "../../../src/skirmish/domain/TrenchFrontage";
import { trenchLineScene } from "../fixtures/TrenchLine";
import type { HillMission } from "../../../src/skirmish/domain/HillPositioning";
import type { Skirmish } from "../../../src/skirmish/Simulation";
import type { Squad } from "../../../src/skirmish/Protocol";
import { hillDefenceScene } from "../fixtures/HillDefence";
import { rangedElevation,effectiveRange } from "../../../src/skirmish/domain/ElevationAdvantage";
import { Renderer } from '../../../src/skirmish/client/Renderer';
import { installTroopPresentation } from '../../../src/skirmish/client/troops/TroopPresentation';
import { cavalryImpactScene,cavalryBattleScene } from '../fixtures/CavalryImpact';
import { formationBattleReviewScene } from '../fixtures/FormationBattleReview';
import { chargeDisrupted } from '../../../src/skirmish/domain/ChargeImpact';
import { FIXED,type Command } from '../../../src/skirmish/Protocol';
import { OrderGesture } from '../../../src/skirmish/client/OrderGesture';
import { canCharge } from '../../../src/skirmish/client/ChargeReadiness';
const orderGesture=new OrderGesture();
const canvas=document.querySelector('canvas')!;
const crowdControl=document.createElement('label');
crowdControl.style.cssText='position:absolute;right:18px;bottom:14px;z-index:5;background:#101c24e8;padding:10px;border:1px solid #607c8b';
crowdControl.innerHTML='<input id="crowd" type="checkbox" checked> Infantry crowd pressure (prototype)';
document.body.append(crowdControl);
const renderer=new Renderer(canvas),actors=installTroopPresentation(renderer,undefined,{
  infantryCrowdPress:()=>document.querySelector<HTMLInputElement>('#crowd')?.checked??false,
});
type Mode='battle'|'front'|'flank'|'spears'|'melee'|'manual'|'corner'|'last'|'double'|'large'|'hill'|'elevated'|'flat'|'trench'|'skirmish'|'hybrid';
type Scene={game:Skirmish;riders:Squad[];defenders:Squad[];launch:()=>void;mission?:HillMission};
function create(mode:Mode):Scene{
  if(mode==='hybrid')return hybridCombatScene();
  if(mode==='trench'||mode==='skirmish')return trenchLineScene(mode==='skirmish');
  if(mode==='hill'||mode==='elevated'||mode==='flat')return hillDefenceScene(mode!=='hill',mode!=='flat');
  if(mode==='large')return formationBattleReviewScene();
  if(mode==='double'){
    const {game,rider,defender}=cavalryImpactScene();
    game.updateSquad(rider.id,{definitionId:defender.definitionId,kind:defender.kind,troops:defender.troops,
      manpower:structuredClone(defender.manpower),formation:{...structuredClone(defender.formation!),facing:0},
      x:defender.x,y:defender.y-3*FIXED,charge:null,chargeImpact:undefined});
    const flank=game.addSquad({...structuredClone(rider),id:game.allocateId(),x:defender.x+3*FIXED,y:defender.y,
      formation:{...rider.formation!,facing:16384}});
    game.applyCommand({type:'order',playerId:1,squadIds:[rider.id,flank.id],order:{type:'attack',targetId:defender.id}});
    return {game,riders:[rider,flank],defenders:[defender],launch:()=>{}};
  }
  if(mode==='corner'||mode==='last'){
    const {game,rider,defender}=cavalryImpactScene();
    game.updateSquad(rider.id,{charge:null,chargeImpact:undefined,cavalryMelee:undefined,
      x:defender.x+(mode==='corner'?3*FIXED:0),y:defender.y-3*FIXED,
      ...(mode==='last'?{troops:1}:{}),formation:{...rider.formation!,shape:'mass',transition:undefined}});
    game.applyCommand({type:'order',playerId:1,squadIds:[rider.id],order:{type:'attack',targetId:defender.id}});
    return {game,riders:[rider],defenders:[defender],launch:()=>{}};
  }
  if(mode==='front'){const {game,rider,defender}=cavalryImpactScene();return {game,riders:[rider],defenders:[defender],launch:()=>{}};}
  const scene=cavalryBattleScene(mode==='flank',mode==='spears');
  if(mode==='manual')return {...scene,launch:()=>{}};
  if(mode==='melee'){
    scene.riders.forEach((r,i)=>{
      scene.game.updateSquad(r.id,{y:29*256});
      const error=scene.game.applyCommand({type:'order',playerId:1,squadIds:[r.id],order:{type:'attack',targetId:scene.defenders[i*2].id}});
      if(error)throw Error(error);
    });
    return {...scene,launch:()=>{}};
  }
  return scene;
}
let mode:Mode='manual',scene=create(mode),paused=false,nextStep=0,playerId=1,chargeArmed=false,manualControl=true;
let fitLargeBattle=false;
let feedback='Ready. Cavalry selected.',drag:{x:number;y:number;lastX:number;lastY:number;button:number;shift:boolean;moved:boolean}|undefined;
const labels={hybrid:'Grenadier hybrid · contacting bayonets / rear-target musket fire',trench:'Trench line · right-click to occupy, order out to leave',skirmish:'Reload withdrawal · explicit skirmish stance',battle:'Three charges into two infantry lines',front:'Single front impact',flank:'Three flank charges',spears:'Three charges into braced spears',melee:'Ordinary melee: alternating rank waves',manual:'Manual sandbox',corner:'Oblique corner attack',last:'Last rank: sustained local melee',double:'Infantry reserves: front and flank contact',large:'30 vs 30 · Bronze Age · 24 infantry + 6 cavalry per side',hill:'Screened hill defence · AI moves, deploys and holds',elevated:'Elevated archers · capped +10% range / base damage',flat:'Same ranged duel · no physical heights, no bonus'};
const sideName=(owner:number)=>mode==='hybrid'?(owner===1?'grenadiers':'opponents'):['hill','elevated','flat','trench','skirmish'].includes(mode)?(owner===2?'hill defenders':'attackers'):mode==='large'?`army ${owner}`:owner===1?(mode==='double'?'attackers':'cavalry'):'infantry';
function publish(){const snapshot=scene.game.snapshot();renderer.update(snapshot);actors.update(snapshot);}
function step(){if(!manualControl)scene.launch();scene.game.step();publish();}
function reset(next:Mode='manual'){
  orderGesture.cancel();
  mode=next;scene=create(mode);manualControl=next==='manual';paused=manualControl;nextStep=performance.now()+700;chargeArmed=false;drag=undefined;
  renderer.trenchPreview=undefined;
  fitLargeBattle=mode==='large';
  feedback=manualControl?'Scene reset. Issue orders, then resume or step.':'Scene reset.';renderer.selectionBox=undefined;
  document.querySelector('#cavalry')!.textContent=['hill','elevated','flat','trench','skirmish'].includes(mode)?'Control attackers':mode==='double'?'Control attackers':'Control cavalry';
  document.querySelector('#infantry')!.textContent=['hill','elevated','flat'].includes(mode)?'Control hill defenders':mode==='large'?'Control army 2':'Control infantry';
  if(mode==='large')document.querySelector('#cavalry')!.textContent='Control army 1';
  if(mode==='hybrid'){document.querySelector('#cavalry')!.textContent='Control grenadiers';document.querySelector('#infantry')!.textContent='Control opponents';}
  document.querySelector('#freeze')!.textContent=mode==='large'?'Freeze battle':'Freeze rank handoff';
  actors.reset();renderer.setMap(scene.game.map);renderer.selected.clear();
  for(const s of scene.game.squads)if(s.playerId===playerId)renderer.selected.add(s.id);
  if(mode==='large')renderer.selected.clear();
  publish();renderer.home();renderer.focusStartingLocation(scene.game.map.ref(32,mode==='hybrid'?38:30));
  renderer.zoom(mode==='large'?1.5:mode==='front'?3:2.4,canvas.clientWidth/2,canvas.clientHeight/2);
}

function issue(command:Command){
  manualControl=true;chargeArmed=false;
  const error=scene.game.applyCommand(command);
  feedback=error?`Rejected at tick ${scene.game.tick}: ${error}`:`${command.type==='order'?command.order.type:command.type} issued at tick ${scene.game.tick}.`;
  publish();
}
const selected=()=>[...renderer.selected].filter(id=>scene.game.squad(id)?.playerId===playerId);
const position=(event:MouseEvent)=>{const rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};};
canvas.addEventListener('contextmenu',event=>event.preventDefault());
canvas.addEventListener('pointerdown',event=>{
  if(event.button>2)return;
  event.preventDefault();canvas.focus();canvas.setPointerCapture(event.pointerId);
  const p=position(event);drag={...p,lastX:p.x,lastY:p.y,button:event.button,shift:event.shiftKey,moved:false};
});
canvas.addEventListener('pointermove',event=>{
  const p=position(event);renderer.hoveredSquadId=renderer.squadAt(p.x,p.y)?.id??null;
  if(!drag)return;
  if(Math.hypot(p.x-drag.x,p.y-drag.y)>5)drag.moved=true;
  if(drag.button===1)renderer.pan(p.x-drag.lastX,p.y-drag.lastY);
  if(drag.button===0&&drag.moved)renderer.selectionBox={x1:drag.x,y1:drag.y,x2:p.x,y2:p.y};
  if(drag.button===2&&drag.moved){const a=renderer.world(drag.x,drag.y),b=renderer.world(p.x,p.y),snap=scene.game.snapshot();const tiles=trenchFrontage(snap.width,playerId,snap.buildings,snap.expansion?.barriers??[],{x:Math.round(a.x*FIXED),y:Math.round(a.y*FIXED)},{x:Math.round(b.x*FIXED),y:Math.round(b.y*FIXED)});renderer.trenchPreview=tiles?{tiles,color:'#83d7ee',capacity:tiles.length*6,required:selected().reduce((n,id)=>n+(scene.game.squad(id)?.manpower?.capacity??0),0)}:undefined;}
  drag.lastX=p.x;drag.lastY=p.y;
});
canvas.addEventListener('pointerup',event=>{
  if(!drag)return;
  const start=drag,p=position(event);drag=undefined;renderer.selectionBox=undefined;renderer.trenchPreview=undefined;
  if(start.button===0){
    if(!start.shift)renderer.selected.clear();
    if(start.moved){for(const s of scene.game.snapshot().squads)if(s.playerId===playerId&&renderer.squadIntersectsBox(s,start.x,start.y,p.x,p.y))renderer.selected.add(s.id);}
    else {const s=renderer.squadAt(p.x,p.y,playerId);if(s){renderer.selected.add(s.id);renderer.inspectedSquadId=s.id;}}
  }else if(start.button===2){
    const ids=selected(),tile=renderer.tileAt(p.x,p.y);if(!ids.length||tile===null)return;
    if(start.moved){const a=renderer.world(start.x,start.y),b=renderer.world(p.x,p.y),snap=scene.game.snapshot();const tiles=trenchFrontage(snap.width,playerId,snap.buildings,snap.expansion?.barriers??[],{x:Math.round(a.x*FIXED),y:Math.round(a.y*FIXED)},{x:Math.round(b.x*FIXED),y:Math.round(b.y*FIXED)});if(tiles){issue({type:'occupy',playerId,squadIds:ids,tile:tiles[0],frontageTiles:tiles,append:start.shift});return;}}
    const hit=renderer.squadAt(p.x,p.y),target=hit&&hit.playerId!==playerId?hit:undefined;
    if(!target&&scene.game.expansion!.trenches.at(tile,playerId)){issue({type:'occupy',playerId,squadIds:ids,tile,append:start.shift});return;}
    if(chargeArmed){const world=renderer.world(p.x,p.y);issue({type:'charge',playerId,squadIds:ids,x:target?.x??Math.round(world.x*FIXED),y:target?.y??Math.round(world.y*FIXED),...(target?{targetId:target.id}:{})});}
    else {
      const world=renderer.world(p.x,p.y),x=target?.x??Math.round(world.x*FIXED),y=target?.y??Math.round(world.y*FIXED);
      orderGesture.submit({time:performance.now(),...p,context:`${playerId}:${ids.sort((a,b)=>a-b).join(',')}`,
        single:()=>issue({type:'order',playerId,squadIds:ids,order:target?{type:'attack',targetId:target.id}:{type:'move',tile},append:start.shift})},start.shift?undefined:()=>{
          const chargers=ids.filter(id=>canCharge(scene.game.squad(id)!,scene.game.tick,x,y));
          if(chargers.length)issue({type:'charge',playerId,squadIds:chargers,x,y,...(target?{targetId:target.id}:{})});
          else feedback='No selected squad can rush to that destination.';
        });
    }
  }
});
canvas.addEventListener('pointercancel',()=>{drag=undefined;renderer.selectionBox=undefined;});
canvas.addEventListener('wheel',event=>{event.preventDefault();const p=position(event);renderer.zoom(Math.exp(-event.deltaY*.0015),p.x,p.y);},{passive:false});
document.querySelector('#manual')!.addEventListener('click',()=>reset('manual'));
for(const [id,owner] of [['cavalry',1],['infantry',2]] as const)document.querySelector(`#${id}`)!.addEventListener('click',()=>{
  playerId=owner;chargeArmed=false;renderer.selected.clear();for(const s of scene.game.squads)if(s.playerId===owner)renderer.selected.add(s.id);
  feedback=`Controlling ${sideName(owner)}.`;
});
document.querySelector('#charge')!.addEventListener('click',()=>{chargeArmed=true;feedback='Charge armed: right-click the target. Escape cancels.';});
document.querySelector('#hold')!.addEventListener('click',()=>{const ids=selected();if(ids.length)issue({type:'order',playerId,squadIds:ids,order:{type:'hold'}});});
canvas.tabIndex=0;
canvas.addEventListener('keydown',event=>{
  if(event.code==='Space'){event.preventDefault();paused=!paused;}
  if(event.code==='Escape'){chargeArmed=false;feedback='Charge cancelled.';}
});
document.querySelector('#battle')!.addEventListener('click',()=>reset('battle'));
document.querySelector('#melee')!.addEventListener('click',()=>reset('melee'));
document.querySelector('#corner')!.addEventListener('click',()=>reset('corner'));
document.querySelector('#last')!.addEventListener('click',()=>reset('last'));
document.querySelector('#double')!.addEventListener('click',()=>reset('double'));
document.querySelector('#large')!.addEventListener('click',()=>reset('large'));
for(const next of ['hybrid','hill','elevated','flat','trench','skirmish'] as const)document.querySelector('#'+next)!.addEventListener('click',()=>reset(next));
document.querySelector('#stance')!.addEventListener('click',()=>{const ids=selected();if(ids.length)issue({type:'stance',playerId,squadIds:ids,stance:ids.every(id=>scene.game.squad(id)?.stance==='skirmish')?'default':'skirmish'});});
document.querySelector('#destroy-trench')!.addEventListener('click',()=>{const trench=scene.game.expansion!.fortifications.barriers.find(b=>b.kind==='trench');if(trench)scene.game.expansion!.fortifications.updateBarrier(trench.id,{health:0});});
document.querySelector('#step')!.addEventListener('click',()=>{step();paused=true;});
document.querySelector('#withdraw')!.addEventListener('click',()=>{
  const error=scene.game.applyCommand({type:'order',playerId:1,squadIds:scene.riders.map(r=>r.id),order:{type:'move',tile:scene.game.map.ref(32,24)}});
  if(error)throw Error(error);paused=false;nextStep=performance.now();
});
document.querySelector('#front')!.addEventListener('click',()=>reset('front'));
document.querySelector('#flank')!.addEventListener('click',()=>reset('flank'));
document.querySelector('#spears')!.addEventListener('click',()=>reset('spears'));
document.querySelector('#pause')!.addEventListener('click',()=>paused=!paused);
document.querySelector('#freeze')!.addEventListener('click',()=>{
  reset(mode);for(let i=0;i<240 && !(mode==='melee'?scene.riders.some(r=>r.cavalryMelee):scene.riders.every(r=>r.cavalryEngagement?.phase==='engaged'));i++)step();
  const c=scene.riders.find(r=>r.cavalryMelee)?.cavalryMelee?.current;
  if(c)while(scene.game.tick<c.tick+Math.floor(c.interval/3)+2)step();paused=true;
});
reset();
function frame(now:number){
  if(!paused&&now>=nextStep){step();nextStep=now+50;if(!manualControl&&scene.game.tick>=(mode==='hill'?2400:mode==='elevated'||mode==='flat'?1200:mode==='hybrid'||mode==='large'||mode==='trench'||mode==='skirmish'?2400:mode==="last"?100:mode==='double'?180:480))paused=true;}
  actors.beginFrame(now,1,paused);renderer.draw(now,1,paused);actors.endFrame(now,0);
  if(fitLargeBattle){
    // Fit after the renderer has measured the canvas, including on reset.
    fitLargeBattle=false;renderer.focusStartingLocation(gameMapCenter());
    const scale=Math.min(canvas.clientWidth/40,canvas.clientHeight/32);
    renderer.zoom(scale/renderer.pixelsPerCell,canvas.clientWidth/2,canvas.clientHeight/2);
  }
  const {game,riders,defenders}=scene;
  const phases=riders.map(r=>r.troops<=0?'fallen':r.cavalryEngagement?.phase??r.charge?.phase??(r.cavalryMelee?'rank melee':r.fighting?'local melee':'approaching')).join(' / ');
  const totals=(army:typeof riders)=>{const live=army.map(s=>game.squad(s.id)).filter(s=>s&&s.troops>0);return `${live.length} formations / ${live.reduce((n,s)=>n+s!.troops,0)} soldiers`;};
  document.querySelector('#status')!.textContent=mode==='large'?`${labels[mode]} · tick ${game.tick} · Army 1: ${totals(riders)} · Army 2: ${totals(defenders)}${paused?' · paused':''}`:`${labels[mode]} · tick ${game.tick} · ${phases} · ${defenders.filter(d=>chargeDisrupted(d,game.tick)).length} disrupted · ${riders.filter(r=>r.chargeImpact).length} impacts${paused?' · paused':''}`;
  if(mode==='hybrid'){const s=game.squad(riders[0].id),w=s?.weaponState;document.querySelector('#status')!.textContent=`${labels[mode]} · tick ${game.tick} · bayonet shot ${w?.melee?.lastShotTick??'none'} · musket shot ${w?.ranged?.lastShotTick??'none'} · musket ready ${w?.ranged?.nextTick??'none'}${paused?' · paused':''}`;}
  if(mode==='hill'){const h=scene.mission?.hill;document.querySelector('#status')!.textContent=`${labels[mode]} · tick ${game.tick} · ${h?.phase??'waiting for index'} · held ${h?.committed===undefined?0:((game.tick-h.committed)/20).toFixed(1)}s · ${scene.mission?.reason??''}`;}
  if(mode==='trench'||mode==='skirmish'){document.querySelector('#status')!.textContent=`${labels[mode]} · tick ${game.tick} · ${defenders.map(d=>{const s=game.squad(d.id);return s?`${s.occupancy?.phase??s.stance??'default'} / ${s.occupancy?.reservedCapacity??0} reserved / ${s.lastWithdrawTick===undefined?'no withdrawal':'withdraw '+s.lastWithdrawTick}`:'fallen';}).join(' · ')}`;}
  if(mode==='elevated'||mode==='flat'){const a=defenders[0],b=riders[0],p=game.expansion!.unit(a).attack,h=rangedElevation(game,a,p,b);document.querySelector('#status')!.textContent=`${labels[mode]} · tick ${game.tick} · high side +${(h.rangeBp-10000)/100}% range / +${(h.damageBp-10000)/100}% base damage · effective range ${(effectiveRange(game,a,p,b)/FIXED).toFixed(2)} tiles · soldiers ${a.troops} vs ${b.troops}`;}
  document.querySelector('#control-status')!.textContent=`Control: ${sideName(playerId)} · ${selected().length} selected · ${chargeArmed?'CHARGE armed · ':''}${feedback}`;
  requestAnimationFrame(frame);
}requestAnimationFrame(frame);
function gameMapCenter(){return scene.game.map.ref(32,31);}

