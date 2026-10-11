import { RUSSIAN_TROOP_ACTORS } from '../../../src/skirmish/client/troops/RussianTroopCatalogue';
import { UNITS } from '../../../src/skirmish/content/Units';
import { SOLDIER_SCALE } from '../../../src/skirmish/content/SoldierScale';
import { troopAssetUrl } from '../../../src/skirmish/client/troops/TroopAssetUrls';
import { clipFrame, type ActorClip, type ActorManifest } from '../../../src/skirmish/client/troops/TroopFormationModel';
import type { TroopActorDefinition } from '../../../src/skirmish/client/troops/TroopActors';

const element = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const storageKey='aof-cavalry-scale-review-v1';
const draftValues=new Map<string,number>();
try {
  const saved=JSON.parse(localStorage.getItem(storageKey)??'{}');
  for(const [key,value] of Object.entries(saved))if(typeof value==='number' && Number.isFinite(value) && value>0 && value<=3)draftValues.set(key,value);
} catch { /* A missing or invalid review draft starts from current authored values. */ }
interface Asset {clip:ActorClip;image:HTMLImageElement;troop:TroopActorDefinition}
const assets=new Map<string,Promise<Asset>>();
function load(troop:TroopActorDefinition):Promise<Asset> {
  let pending=assets.get(troop.name);
  if(!pending){pending=(async()=>{
    const root=troop.assetRoot!;
    const response=await fetch(troopAssetUrl(root+'animations.json'));
    if(!response.ok)throw Error(`Missing manifest for ${troop.name}`);
    const manifest:ActorManifest=await response.json();
    if(manifest.actorCount!==1)throw Error(`${troop.name} is not individual artwork`);
    const clip=manifest.animations.find(c=>c.id==='idle');
    if(!clip)throw Error(`Missing idle for ${troop.name}`);
    const image=new Image();image.src=troopAssetUrl(root+clip.file);await image.decode();
    // The live renderer divides every clip scale by its idle scale.
    return{clip:{...clip,scale:1},image,troop};
  })();assets.set(troop.name,pending);}
  return pending;
}
const clubmanId=UNITS.find(unit=>unit.age==='StoneAge' && unit.troopClass==='frontline')?.id;
const clubman=RUSSIAN_TROOP_ACTORS.get(clubmanId??'')!;
if(!clubman)throw Error('Stone Age Clubman reference missing');
const groups=new Map<string,{troop:TroopActorDefinition;names:string[];ids:string[];key:string}>();
for(const unit of UNITS){
  const troop=RUSSIAN_TROOP_ACTORS.get(unit.id);if(!troop?.mounted)continue;
  const key=`${unit.age}:${unit.troopClass}`;
  const row=groups.get(key)??{troop,names:[],ids:[],key};row.names.push(unit.name);row.ids.push(unit.id);groups.set(key,row);
}
const rows:{canvas:HTMLCanvasElement;asset?:Asset;key:string;troop:TroopActorDefinition}[]=[];
const draft=()=>({schemaVersion:1,soldierScale:SOLDIER_SCALE,reference:clubman.name,overrides:Object.fromEntries(
  [...groups.values()].filter(row=>(draftValues.get(row.key)??row.troop.memberScale)!==row.troop.memberScale)
    .map(row=>[row.key,{memberScale:draftValues.get(row.key),previousMemberScale:row.troop.memberScale,artwork:row.troop.name,unitIds:row.ids}]))});
function publish():void {
  localStorage.setItem(storageKey,JSON.stringify(Object.fromEntries(draftValues)));
  element<HTMLTextAreaElement>('draft').value=JSON.stringify(draft(),null,2);
  element('status').textContent=`${groups.size} cavalry artworks · ${Object.keys(draft().overrides).length} adjusted · draft only`;
}
for(const row of groups.values()){
  const card=document.createElement('section');card.className='card';
  const title=document.createElement('h2');title.textContent=row.names.join(' / ');
  const subtitle=document.createElement('p');subtitle.textContent=`${row.troop.name} · ${row.ids.join(', ')}`;
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=280;
  canvas.setAttribute('aria-label',`${row.names.join(', ')} beside Stone Age Clubman`);
  const controls=document.createElement('div');controls.className='controls';
  const range=document.createElement('input');range.type='range';range.min='.25';range.max='2.5';range.step='.01';range.setAttribute('aria-label',`${row.names[0]} scale multiplier`);
  const number=document.createElement('input');number.type='number';number.min='.01';number.max='3';number.step='.005';number.setAttribute('aria-label',`${row.names[0]} authored scale`);
  const label=document.createElement('span');label.className='value';
  const reset=document.createElement('button');reset.textContent='Reset';
  function update(value:number):void {
    if(!Number.isFinite(value)||value<=0||value>3)return;
    draftValues.set(row.key,value);number.value=String(Number(value.toFixed(6)));
    range.value=String(value/row.troop.memberScale);label.textContent=`${(value/row.troop.memberScale).toFixed(2)}× current`;publish();
  }
  range.addEventListener('input',()=>update(Number(range.value)*row.troop.memberScale));
  number.addEventListener('input',()=>update(Number(number.value)));
  reset.addEventListener('click',()=>update(row.troop.memberScale));
  controls.append(range,number,label,reset);card.append(title,subtitle,canvas,controls);element('cards').append(card);
  const view={canvas,key:row.key,troop:row.troop,asset:undefined as Asset|undefined};rows.push(view);
  update(draftValues.get(row.key)??row.troop.memberScale);
  load(row.troop).then(asset=>{view.asset=asset;}).catch(error=>{subtitle.className='error';subtitle.textContent=String(error);});
}
let reference:Asset|undefined;load(clubman).then(asset=>reference=asset).catch(error=>{element('status').textContent=String(error);});
const zoom=element<HTMLInputElement>('zoom'),facing=element<HTMLSelectElement>('facing');
zoom.addEventListener('input',()=>element('zoom-value').textContent=`${zoom.value} px / tile`);
let paused=false,clock=0,last=performance.now();
element('pause').addEventListener('click',()=>{paused=!paused;element('pause').textContent=paused?'Resume animation':'Pause animation';});
element('download').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(draft(),null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='cavalry-scale-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
function actor(ctx:CanvasRenderingContext2D,asset:Asset,x:number,scale:number):void {
  const frame=asset.clip.frames[clipFrame(asset.clip,clock)],size=Number(zoom.value)*(2/.75)*scale*SOLDIER_SCALE;
  ctx.save();ctx.translate(x,145);ctx.rotate(Number(facing.value)+(asset.troop.facingOffset??0));
  ctx.drawImage(asset.image,frame.x,frame.y,frame.width,frame.height,-size*frame.pivot.x/frame.width,-size*frame.pivot.y/frame.height,size,size);ctx.restore();
}
function draw(now:number):void {
  if(!paused)clock+=Math.min(100,now-last);last=now;
  for(const row of rows){
    const ctx=row.canvas.getContext('2d')!;ctx.fillStyle='#45553c';ctx.fillRect(0,0,600,280);
    const tile=Number(zoom.value);ctx.strokeStyle='#ffffff0d';ctx.lineWidth=1;
    for(let x=0;x<600;x+=tile){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,280);ctx.stroke();}
    for(let y=0;y<280;y+=tile){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(600,y);ctx.stroke();}
    ctx.fillStyle='#e4ecde';ctx.font='14px system-ui';ctx.textAlign='center';ctx.fillText('Stone Age Clubman',170,255);ctx.fillText('Cavalry',420,255);
    ctx.strokeStyle='#bdceb555';ctx.beginPath();ctx.moveTo(120,145);ctx.lineTo(470,145);ctx.stroke();
    if(reference)actor(ctx,reference,170,clubman.memberScale);
    if(row.asset)actor(ctx,row.asset,420,draftValues.get(row.key)??row.troop.memberScale);
  }
  requestAnimationFrame(draw);
}
publish();requestAnimationFrame(draw);
