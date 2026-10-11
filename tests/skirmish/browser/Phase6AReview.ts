import { GameMapImpl } from "../../../src/core/game/GameMap";
import { Renderer } from "../../../src/skirmish/client/Renderer";
import { installTroopPresentation } from "../../../src/skirmish/client/troops/TroopPresentation";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { FIXED, type Squad } from "../../../src/skirmish/Protocol";
import { UNIT } from "../../../src/skirmish/content/Units";
import { createManpower } from "../../../src/skirmish/domain/Manpower";
import { createFormation, formationEnvelope, formationSlots, TURN } from "../../../src/skirmish/domain/FormationGeometry";
import { formationContact, formationApproach } from "../../../src/skirmish/domain/FormationContact";
import { frontageLayout, } from "../../../src/skirmish/domain/FormationProfiles";
import { formationDoctrine } from "../../../src/skirmish/domain/FormationGeometry";
import { layoutBattleLine } from "../../../src/skirmish/domain/BattleLineLayout";
import { transportScene } from "../fixtures/TacticalScenes";

const renderer=new Renderer(document.querySelector("canvas")!),actors=installTroopPresentation(renderer);
let game:Skirmish,active:Squad,paused=true,mode="Profiles",nextStep=0,opponent:Squad|undefined,reformStarts=0;
const observedReforms=new Map<number,number>();
const status=document.querySelector<HTMLElement>("#status")!;
function show(next:Skirmish,s:Squad,label:string,freeze=true){game=next;active=s;mode=label;paused=freeze;opponent=undefined;reformStarts=0;observedReforms.clear();actors.reset();renderer.setMap(game.map);renderer.selected.clear();renderer.selected.add(s.id);renderer.update(game.snapshot());actors.update(game.snapshot());renderer.home();renderer.focusStartingLocation(game.map.ref(Math.floor(s.x/FIXED),Math.floor(s.y/FIXED)));renderer.zoom(1.8,innerWidth/2,(innerHeight-64)/2);}
function plain(){const terrain=new Uint8Array(96*96).fill(133),map=new GameMapImpl(96,96,terrain,terrain.length),g=new Skirmish(map,{seed:42,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1",formationLocomotion:true});const template=structuredClone(g.squads[0]);for(const s of [...g.squads])g.removeSquad(s.id);return {g,template};}
function add(g:Skirmish,template:Squad,id:string,n:number,x:number,y:number,shape:import("../../../src/skirmish/domain/FormationGeometry").FormationShape){const unit=UNIT.get(id)!,d=formationDoctrine(id),s={...template,id:g.allocateId(),definitionId:id,kind:unit.line,troops:n,manpower:createManpower(unit,n>unit.formationRecipe!.capacity?"enlarged":"base"),formation:{...createFormation(id),shape,layoutTroops:n,frontage:frontageLayout(n,d,shape,32768)?.width},x:x*FIXED,y:y*FIXED,order:{type:"hold" as const},path:[],queuedOrders:[],combatTargetId:null,charge:null,refit:null};return g.addSquad(s);}
function overview(){const {g,template}=plain();const s=add(g,template,"napoleonic-infantry",72,48,43,"line");add(g,template,"stoneage-infantry",12,39,50,"mass");add(g,template,"modern-infantry",8,47,50,"modern-loose");add(g,template,"latemedieval-cavalry",24,54,50,"line");show(g,s,"72 enlarged infantry line / 12 mob / 8 modern infantry / 24 cavalry");}
document.querySelector("#overview")!.addEventListener("click",overview);
document.querySelector("#reform")!.addEventListener("click",()=>{const {g,template}=plain(),s=add(g,template,"napoleonic-infantry",48,43,44,"mass");g.applyCommand({type:"formation",playerId:1,squadIds:[s.id],shape:"line",frontage:1600});g.applyCommand({type:"order",playerId:1,squadIds:[s.id],order:{type:"move",tile:g.map.ref(54,46)}});show(g,s,"Stationary deploy, then move",false);});
document.querySelector("#transport")!.addEventListener("click",()=>{const f=transportScene(72);f.game.applyCommand({type:"order",playerId:1,squadIds:[f.s.id],order:{type:"move",tile:f.map.ref(116,64)}});show(f.game,f.s,"72 troops crossing and landing",false);renderer.focusStartingLocation(f.map.ref(88,64));renderer.zoom(.75,innerWidth/2,(innerHeight-64)/2);});
document.querySelector("#cap")!.addEventListener("click",()=>{overview();const gesture={start:{x:8*FIXED,y:40*FIXED},end:{x:88*FIXED,y:40*FIXED}};const line=layoutBattleLine([{id:active.id,origin:active,squad:active}],gesture)!;renderer.deploymentPreview={line,valid:true,color:"#c4efff"};mode="80-tile drag capped at the approved maximum";});
overview();
document.querySelector("#narrow")!.addEventListener("click",()=>{
  overview();const gesture={start:{x:44.75*FIXED,y:43*FIXED},end:{x:51.25*FIXED,y:43*FIXED}};
  const error=game.applyCommand({type:"order",playerId:1,squadIds:[active.id],order:{type:"move",tile:game.map.ref(48,43)},deploymentLine:gesture});
  if(error){mode=error;return;}
  for(let tick=0;tick<600;tick++)game.step();
  renderer.update(game.snapshot());actors.update(game.snapshot());mode="Completed 6.5-tile player deployment";
});
document.querySelector("#melee")!.addEventListener("click",()=>{
  const {g,template}=plain(),a=add(g,template,"bronzeage-infantry",24,48,44,"shield-wall"),b=add(g,template,"bronzeage-infantry",24,48,49,"shield-wall");
  g.updateSquad(b.id,{playerId:2,formation:{...b.formation!,facing:TURN/2}});
  g.applyCommand({type:"order",playerId:1,squadIds:[a.id],order:{type:"attack",targetId:b.id}});
  g.applyCommand({type:"order",playerId:2,squadIds:[b.id],order:{type:"attack",targetId:a.id}});
  for(let tick=0;tick<80;tick++)g.step();
  show(g,a,"Melee contact; resume to watch casualties",true);opponent=b;renderer.zoom(2,innerWidth/2,(innerHeight-64)/2);
});
document.querySelector("#pause")!.addEventListener("click",()=>{paused=!paused;});
let flanker:Squad|undefined;
function flankScene(steps=20){
  const {g,template}=plain(),a=add(g,template,'bronzeage-infantry',24,48,46,'shield-wall'),b=add(g,template,'bronzeage-infantry',24,48,50,'shield-wall'),c=add(g,template,'bronzeage-infantry',24,52,46,'shield-wall');
  g.updateSquad(b.id,{playerId:2,formation:{...b.formation!,facing:TURN/2}});
  g.updateSquad(c.id,{playerId:2,formation:{...c.formation!,facing:TURN/4}});
  g.updateSquad(b.id,formationApproach(b,a,0,0,Math.PI/2));g.updateSquad(c.id,formationApproach(c,a,0,0,0));
  for(const [s,target] of [[a,b],[b,a],[c,a]])g.applyCommand({type:'order',playerId:s.playerId,squadIds:[s.id],order:{type:'attack',targetId:target.id}});
  for(let i=0;i<steps;i++)g.step();
  show(g,a,steps===3?`Committed front + flank strike; ${a.meleeStrike?.contacts.length??0} edges; strike tick ${a.meleeStrike?.tick??'none'}`:'Front and flank defend together',true);opponent=b;flanker=c;renderer.zoom(2,innerWidth/2,(innerHeight-64)/2);
}
document.querySelector('#flank')!.addEventListener('click',()=>flankScene());
document.querySelector('#attack-proof')!.addEventListener('click',()=>flankScene(3));
document.querySelector('#prioritize-flank')!.addEventListener('click',()=>{
  if(!flanker || !game.squad(flanker.id))return;
  const facing=active.formation!.facing;
  game.applyCommand({type:'order',playerId:active.playerId,squadIds:[active.id],order:{type:'attack',targetId:flanker.id}});
  for(let i=0;i<4;i++)game.step();
  renderer.update(game.snapshot());actors.update(game.snapshot());opponent=flanker;
  mode=`Flank priority; physical facing ${facing} → ${active.formation!.facing}`;
});
function frame(now:number){
  if(!paused&&now>=nextStep){
    game.step();nextStep=now+50;
    for(const s of game.squads){const start=s.formation?.transition?.startTick;if(start!==undefined&&observedReforms.get(s.id)!==start){reformStarts++;observedReforms.set(s.id,start);}}
    renderer.update(game.snapshot());actors.update(game.snapshot());
  }
  actors.beginFrame(now,1,paused);renderer.draw(now,1,paused);actors.endFrame(now,0);
  const e=formationEnvelope(active,game.tick),slots=formationSlots(active,game.tick),d=formationDoctrine(active.definitionId);
  const width=(Math.max(...slots.map(p=>p.x))-Math.min(...slots.map(p=>p.x))+d.bodyWidth)/FIXED;
  status.textContent=`${mode} · tick ${game.tick} · ${active.afloat?"transport hull":e.shape} · ${(e.width/FIXED).toFixed(2)} × ${(e.depth/FIXED).toFixed(2)} tiles · actual width ${width.toFixed(2)} · ${active.troops} troops`+(opponent?` vs ${opponent.troops} · gap ${(formationContact(active,opponent,game.tick).gap/FIXED).toFixed(2)} · reforms ${reformStarts}`:"");
  requestAnimationFrame(frame);
}requestAnimationFrame(frame);

