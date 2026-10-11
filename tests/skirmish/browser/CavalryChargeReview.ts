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
const renderer=new Renderer(canvas),actors=installTroopPresentation(renderer);
type Mode='battle'|'front'|'flank'|'spears'|'melee'|'manual'|'corner'|'last'|'double'|'large';
function create(mode:Mode){
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
const labels={battle:'Three charges into two infantry lines',front:'Single front impact',flank:'Three flank charges',spears:'Three charges into braced spears',melee:'Ordinary melee: alternating rank waves',manual:'Manual sandbox',corner:'Oblique corner attack',last:'Last rank: sustained local melee',double:'Infantry reserves: front and flank contact',large:'30 vs 30 · Bronze Age · 24 infantry + 6 cavalry per side'};
const sideName=(owner:number)=>mode==='large'?`army ${owner}`:owner===1?(mode==='double'?'attackers':'cavalry'):'infantry';
function publish(){const snapshot=scene.game.snapshot();renderer.update(snapshot);actors.update(snapshot);}
function step(){if(!manualControl)scene.launch();scene.game.step();publish();}
function reset(next:Mode='manual'){
  orderGesture.cancel();
  mode=next;scene=create(mode);manualControl=next==='manual';paused=manualControl;nextStep=performance.now()+700;chargeArmed=false;drag=undefined;
  fitLargeBattle=mode==='large';
  feedback=manualControl?'Scene reset. Issue orders, then resume or step.':'Scene reset.';renderer.selectionBox=undefined;
  document.querySelector('#cavalry')!.textContent=mode==='double'?'Control attackers':'Control cavalry';
  document.querySelector('#infantry')!.textContent=mode==='large'?'Control army 2':'Control infantry';
  if(mode==='large')document.querySelector('#cavalry')!.textContent='Control army 1';
  document.querySelector('#freeze')!.textContent=mode==='large'?'Freeze battle':'Freeze rank handoff';
  actors.reset();renderer.setMap(scene.game.map);renderer.selected.clear();
  for(const s of scene.game.squads)if(s.playerId===playerId)renderer.selected.add(s.id);
  if(mode==='large')renderer.selected.clear();
  publish();renderer.home();renderer.focusStartingLocation(scene.game.map.ref(32,30));
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
  drag.lastX=p.x;drag.lastY=p.y;
});
canvas.addEventListener('pointerup',event=>{
  if(!drag)return;
  const start=drag,p=position(event);drag=undefined;renderer.selectionBox=undefined;
  if(start.button===0){
    if(!start.shift)renderer.selected.clear();
    if(start.moved){for(const s of scene.game.snapshot().squads)if(s.playerId===playerId&&renderer.squadIntersectsBox(s,start.x,start.y,p.x,p.y))renderer.selected.add(s.id);}
    else {const s=renderer.squadAt(p.x,p.y,playerId);if(s){renderer.selected.add(s.id);renderer.inspectedSquadId=s.id;}}
  }else if(start.button===2){
    const ids=selected(),tile=renderer.tileAt(p.x,p.y);if(!ids.length||tile===null)return;
    const hit=renderer.squadAt(p.x,p.y),target=hit&&hit.playerId!==playerId?hit:undefined;
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
  if(!paused&&now>=nextStep){step();nextStep=now+50;if(!manualControl&&scene.game.tick>=(mode==='large'?2400:mode==="last"?100:mode==='double'?180:480))paused=true;}
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
  document.querySelector('#control-status')!.textContent=`Control: ${sideName(playerId)} · ${selected().length} selected · ${chargeArmed?'CHARGE armed · ':''}${feedback}`;
  requestAnimationFrame(frame);
}requestAnimationFrame(frame);
function gameMapCenter(){return scene.game.map.ref(32,31);}

