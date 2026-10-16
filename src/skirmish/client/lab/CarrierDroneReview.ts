import {GameMapImpl} from '../../../core/game/GameMap';
import {Skirmish} from '../../Simulation';
import {FIXED,TICKS_PER_SECOND,type Command} from '../../Protocol';
import {TECHNOLOGIES} from '../../content/Technology';
import type {Aircraft} from '../../domain/Definitions';
import {AircraftPresentation} from '../AircraftPresentation';
import {AircraftGroundPresentation} from '../AircraftGroundPresentation';
import {CarrierAircraftPresentation} from '../CarrierAircraftPresentation';
import {AircraftView} from '../AircraftView';
import {BoatPresentation} from '../BoatPresentation';
import {EraArtwork} from '../EraArtwork';
import {ImpactPresentation} from '../ImpactPresentation';
import {shipSpriteSize} from '../MapSymbols';
import {sortieCommand} from '../Controls';
const canvas=document.querySelector('canvas')!,ctx=canvas.getContext('2d')!;
const status=document.querySelector<HTMLOutputElement>('#status')!,metrics=document.querySelector<HTMLElement>('#metrics')!;
const art=new EraArtwork(),view=new AircraftView(),flight=new AircraftPresentation(),ground=new AircraftGroundPresentation(),deck=new CarrierAircraftPresentation(),boats=new BoatPresentation(),impacts=new ImpactPresentation();
const scale=40,screen=(p:{x:number;y:number})=>({x:(p.x/FIXED-8)*scale,y:(p.y/FIXED-24)*scale});
let game:Skirmish,carrierId:number,droneId:number,shoreId:number,targetId:number,unitId:number;
let paused=false,last=0,accumulator=0,sailing=false;
const execute=(command:Command|undefined|null)=>{status.textContent=command?game.applyCommand(command)??'Order accepted':'No ready aircraft available';};
function reset(){
 const data=new Uint8Array(100*80).fill(133);for(let y=32;y<80;y++)data.fill(0,y*100,(y+1)*100);
 game=new Skirmish(new GameMapImpl(100,80,data,data.length),{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1'});
 const e=game.expansion!;for(const p of game.players){e.progression.states[p.id].completed=TECHNOLOGIES.map(t=>t.id);e.progression.states[p.id].age='Modern';p.gold=1000000;}
 e.diplomacy.action(game.players[0],game.players[1],'declare',game.tick);
 const field=(type:'airstrip'|'drone-facility',x:number,owner=1)=>{const b=game.addBuilding({id:game.allocateId(),playerId:owner,type,tile:29*100+x,age:'Modern',health:10000,maxHealth:10000,remainingTicks:0});game.owners[b.tile]=owner;return b;};
 const shore=field('airstrip',12),drones=field('drone-facility',22),target=field('airstrip',33,2);droneId=drones.id;targetId=target.id;
 const carrier=game.addShip({id:game.allocateId(),playerId:1,kind:'carrier',definitionId:'earlymodern-carrier',x:20*FIXED,y:35*FIXED,health:6500,destination:null,waypoints:[],path:[],nextPathIndex:0,fighting:false});carrierId=carrier.id;
 const plane=(base:{id:number},kind:Aircraft['definitionId'])=>{const b=game.building(base.id),s=game.ship(base.id),point=b?e.battle.position(b):s!;const a:Aircraft={id:game.allocateId(),playerId:1,definitionId:kind,age:'Modern',airfieldId:base.id,x:point.x,y:point.y,health:1000,state:'ready',target:null,reloadTick:0,fuelTicks:5000};e.aircraft.push(a);return a;};
 for(const kind of ['bomber','bomber','fighter','fighter'] as const)plane(carrier,kind);
 shoreId=plane(shore,'bomber').id;for(let i=0;i<4;i++)plane(drones,'drone');
 const unit=game.squads.find(s=>s.playerId===2&&s.troops>0)!;unitId=unit.id;game.updateSquad(unit.id,{x:30*FIXED,y:27*FIXED,order:{type:'hold'}});
 e.supply.inventories[1]['payload:atomic']=2;
 flight.reset();ground.reset();deck.reset();boats.reset();impacts.reset();accumulator=0;sailing=false;status.textContent='Ready';update();
}
function update(){const s=game.snapshot();flight.update(s);ground.update(s);deck.update(s);boats.update(s,performance.now());impacts.update(s.expansion!.projectiles,s.tick);}
function swarm(unit=false){const a=game.expansion!.aircraft.find(a=>a.airfieldId===droneId&&a.state==='ready');const b=game.building(targetId),s=game.squad(unitId);if(!a||(!unit&&!b)||unit&&!s){status.textContent='No prepared swarm or target';return;}const target=unit?s!:game.expansion!.battle.position(b!);execute({type:'sortie',playerId:1,mission:'drone',aircraftIds:[a.id],x:target.x,y:target.y,...(unit?{targetUnitId:unitId}:{targetBuildingId:targetId})});update();}
document.querySelector<HTMLButtonElement>('#reset')!.onclick=reset;
document.querySelector<HTMLButtonElement>('#drone-building')!.onclick=()=>swarm();
document.querySelector<HTMLButtonElement>('#drone-unit')!.onclick=()=>swarm(true);
document.querySelector<HTMLButtonElement>('#transfer')!.onclick=()=>execute({type:'transfer-aircraft',playerId:1,buildingId:carrierId,aircraftIds:[shoreId]});
document.querySelector<HTMLButtonElement>('#recruit')!.onclick=()=>execute({type:'recruit-aircraft',playerId:1,buildingId:carrierId,definitionId:'fighter'});
for(const [id,mission] of [['bombing','bombing'],['atomic','atomic'],['patrol','patrol']] as const)document.querySelector<HTMLButtonElement>('#'+id)!.onclick=()=>execute(sortieCommand(game.snapshot(),1,33*FIXED,29*FIXED,false,new Set(),mission,new Set([carrierId])));
document.querySelector<HTMLButtonElement>('#sail')!.onclick=()=>{sailing=!sailing;execute({type:'sail',playerId:1,shipIds:[carrierId],tile:35*100+(sailing?26:20)});};
document.querySelector<HTMLButtonElement>('#sink')!.onclick=()=>{game.updateShip(carrierId,{health:0});status.textContent='Carrier sunk';};
document.querySelector<HTMLButtonElement>('#pause')!.onclick=e=>{paused=!paused;(e.currentTarget as HTMLButtonElement).textContent=paused?'Play':'Pause';};
function drawImage(id:string,clip:string,tick:number,p:{x:number;y:number},size:number,angle=0){const frame=art.get(id,clip,tick);if(!frame)return;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(angle);ctx.drawImage(frame.source,frame.x,frame.y,frame.width,frame.height,-size*frame.pivotX,-size*frame.pivotY,size,size);ctx.restore();}
function render(now:number){
 const speed=Number(document.querySelector<HTMLSelectElement>('#speed')!.value);
 if(last&&!paused){accumulator+=Math.min(now-last,150)*speed;while(accumulator>=50){game.step();const unit=game.squad(unitId);if(unit)game.updateSquad(unitId,{x:30*FIXED+Math.round(Math.sin(game.tick/50)*FIXED),y:27*FIXED});update();accumulator-=50;}}last=now;
 ctx.fillStyle='#536446';ctx.fillRect(0,0,1200,620);ctx.fillStyle='#194c5d';ctx.fillRect(0,(32-24)*scale,1200,620);
 for(const b of game.buildings){if(![targetId,droneId].includes(b.id)&&b.type!=='airstrip')continue;const p=screen(game.expansion!.battle.position(b));drawImage('building-modern-'+b.type,'idle',game.tick,p,100);ctx.fillStyle=b.playerId===1?'#dae6cf':'#ffb6a6';ctx.fillText(b.type==='drone-facility'?'Drone facility':b.playerId===2?'Target building':'Shore airfield',p.x-45,p.y-60);}
 const unit=game.squad(unitId);if(unit){const p=screen(unit);ctx.fillStyle='#e6a18b';ctx.fillRect(p.x-13,p.y-7,26,14);ctx.fillText('Moving unit',p.x-30,p.y-17);}
 const carrier=game.ship(carrierId);if(carrier&&carrier.health>0){const pose=boats.shipPose(carrier.id)??{...carrier,angle:0,moving:false};drawImage('earlymodern-carrier',pose.moving?'sailing':'idle',game.tick,screen(pose),shipSpriteSize(scale,'carrier'),pose.angle);}
 for(const a of game.expansion!.aircraft){const f=flight.pose(a.id);if(!f)continue;const pose=deck.pose(a.id,f,scale,1,id=>boats.shipPose(id))??ground.pose(a.id,f,scale,1);view.draw(ctx,screen(pose),pose,art.get(a.definitionId==='drone'?'drone':'modern-'+a.definitionId,a.state==='ready'?'idle':'flight',game.tick),'#c9e1bb',false);}
 for(const effect of impacts.frames(game.tick))drawImage(effect.artworkId,effect.clip,game.tick-effect.start,screen(effect),Math.max(24,effect.radius/FIXED*scale*2));
 const members=game.expansion!.aircraft.filter(a=>a.drone),ready=game.expansion!.aircraft.filter(a=>a.definitionId==='drone'&&a.state==='ready');
 metrics.textContent='Tick '+game.tick+' | Airborne FPV drones: '+members.length+' | Prepared swarms: '+ready.length+' | Target building: '+(game.building(targetId)?.health??0)+' / '+(game.building(targetId)?.maxHealth??0)+' HP | Carrier aircraft: '+game.expansion!.aircraft.filter(a=>a.airfieldId===carrierId).length+' | Queued aboard: '+game.recruitment.byProducer(carrierId).length;
 requestAnimationFrame(render);
}
reset();requestAnimationFrame(render);
