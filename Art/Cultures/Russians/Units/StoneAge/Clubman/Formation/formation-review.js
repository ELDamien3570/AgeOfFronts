import { createFormationPainter, sampleFormation, chargeReviewSteps, chargeReviewPose, actorFrame, reviewTravelDistance, chargeReviewTravelDistance } from "./formation-composition.js";
async function json(url) { const response = await fetch(url,{cache:"no-store"}); if (!response.ok) throw new Error("Missing art data: "+url); return response.json(); }
const [definition, atlas] = await Promise.all([json("formation.json"),json("animations.json")]);
const clips = new Map(), actorImages = new Map(), atlasImages = new Map();
async function image(url) { const result = new Image(); result.decoding="async"; result.src=url; await result.decode(); return result; }
for (const source of definition.actorSources) {
  const url = new URL(source,location.href), metadata = await json(url);
  await Promise.all(metadata.animations.map(async clip => {
    const resource = await image(new URL(clip.file,url));
    if (resource.naturalWidth !== metadata.sheetSize.width || resource.naturalHeight !== metadata.sheetSize.height)
      throw new Error("Invalid actor sheet: "+clip.id);
    clips.set(clip.id,clip); actorImages.set(clip.id,resource);
  }));
}
await Promise.all(atlas.animations.map(async clip => {
  const resource = await image(clip.file);
  if (resource.naturalWidth !== clip.sheetSize.width || resource.naturalHeight !== clip.sheetSize.height)
    throw new Error("Invalid formation sheet: "+clip.id);
  atlasImages.set(clip.id,resource);
}));
const byId = new Map(atlas.animations.map(clip=>[clip.id,clip]));
const elements = Object.fromEntries(["clips","formation","formation-panel","clip-title","description","play","restart","previous","next","scrub","time-output","speed","backdrop","render-mode","slots","repeat","travel","status","sheet"].map(id=>[id,document.getElementById(id)]));
const sequenceDuration = chargeReviewSteps(definition).reduce((sum,step)=>sum+step.durationMs,0);
class FormationReviewModel {
  constructor() { this.selected=byId.has(location.hash.slice(1))?location.hash.slice(1):"charge-sequence"; this.elapsed=0;this.travelElapsed=0;this.playing=true;this.repeat=true;this.speed=1; }
  get duration() { return this.selected==="charge-sequence"?sequenceDuration:byId.get(this.selected).durationMs; }
  get loop() { return this.selected!=="charge-sequence" && byId.get(this.selected).loop; }
  get pose() { return this.selected==="charge-sequence"?chargeReviewPose(definition,this.elapsed):{id:this.selected,timeMs:Math.min(this.duration,this.elapsed)}; }
  select(id) {this.selected=id;this.restart();}
  restart() {this.elapsed=0;this.travelElapsed=0;this.playing=true;}
  seek(time) {this.elapsed=Math.max(0,Math.min(this.duration,time));this.travelElapsed=this.elapsed;this.playing=false;}
  advance(delta) {
    if(!this.playing)return;
    this.elapsed+=delta*this.speed;
    this.travelElapsed+=delta*this.speed;
    if(this.loop)this.elapsed%=this.duration;
    else if(this.elapsed>=this.duration) {
      if(this.repeat && this.elapsed>=this.duration+1000){this.elapsed=0;this.travelElapsed=0;}
      else if(!this.repeat){this.elapsed=this.duration;this.playing=false;}
    }
  }
}
const model = new FormationReviewModel();
const painter = createFormationPainter(definition,clips,actorImages,(w,h)=>{const c=document.createElement("canvas");c.width=w;c.height=h;return c;});
const canvases=[{element:elements.formation,size:512},...Array.from(document.querySelectorAll("[data-size]")).map(element=>({element,size:Number(element.dataset.size)}))];
const options=[{id:"charge-sequence",label:"Full charge sequence",detail:"FOUR PHASES"},...atlas.animations.map(clip=>({id:clip.id,label:clip.label,detail:clip.loop?"LOOP":"PLAYS ONCE"}))];
function updateSelection() {
  elements.scrub.max=String(model.duration);
  for(const button of elements.clips.children){const selected=button.dataset.clip===model.selected;button.setAttribute("aria-selected",String(selected));button.tabIndex=selected?0:-1;}
  elements["formation-panel"].setAttribute("aria-labelledby","clip-"+model.selected);
}
function draw() {
  const pose=model.pose, clip=byId.get(pose.id), index=actorFrame(clip,pose.timeMs), frame=clip.frames[index];
  const baked=elements["render-mode"].value==="baked";
  const sampleTime=baked?frame.timeMs:pose.timeMs;
  const members=sampleFormation(definition,clips,pose.id,sampleTime);
  const travel=elements.travel.checked ? (model.selected==="charge-sequence" ?
    chargeReviewTravelDistance(definition,model.elapsed) : reviewTravelDistance(definition,pose.id,model.travelElapsed)) : 0;
  for(const {element,size} of canvases) {
    const context=element.getContext("2d");context.clearRect(0,0,element.width,element.height);
    context.save();context.translate(element.width/2,element.height/2);context.scale(size/512,size/512);context.translate(-256,-256);
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality="high";
    if(elements.travel.checked && size===512) {
      context.strokeStyle="#b7cba633";context.lineWidth=1;context.setLineDash([3,13]);
      const offset=((-travel%72)+72)%72;
      context.beginPath();
      for(let x=40;x<512;x+=72){context.moveTo(x,0);context.lineTo(x,512);}
      for(let y=offset;y<512;y+=72){context.moveTo(0,y);context.lineTo(512,y);}
      context.stroke();context.setLineDash([]);
    }
    if(baked) {
      context.drawImage(atlasImages.get(pose.id),frame.x,frame.y,512,512,0,0,512,512);
      if(elements.slots.checked)for(const member of members){context.strokeStyle="#efd29a";context.lineWidth=1;context.beginPath();context.moveTo(member.x-5,member.y);context.lineTo(member.x+5,member.y);context.moveTo(member.x,member.y-5);context.lineTo(member.x,member.y+5);context.stroke();}
    } else painter(context,pose.id,pose.timeMs,elements.slots.checked);
    context.restore();
  }
  elements.formation.dataset.clip=pose.id;elements.formation.dataset.frame=String(index);elements.formation.dataset.memberCount=String(members.length);
  elements.formation.dataset.elapsed=String(Math.min(model.elapsed,model.duration));
  elements.formation.dataset.reviewTravel=String(travel);
  elements.scrub.value=String(Math.min(model.elapsed,model.duration));
  elements["time-output"].textContent=(Math.min(model.elapsed,model.duration)/1000).toFixed(2)+" / "+(model.duration/1000).toFixed(2)+" s";
  elements.play.textContent=model.playing?"Pause":"Play";
  elements["clip-title"].textContent=model.selected==="charge-sequence"?"Full charge sequence · "+clip.label:clip.label+" · "+(clip.loop?"Loop":"Plays once");
  elements.description.textContent=model.selected==="charge-sequence"?"Review demonstrates three running loops in the wedge before the attack. Planned gameplay holds Maintain charge until attack or exit.":clip.description;
  elements.sheet.href=clip.file;
  for(const phase of document.querySelectorAll("[data-phase]"))phase.classList.toggle("active",phase.dataset.phase===pose.id);
}
for(const [index,option] of options.entries()) {
  const button=document.createElement("button");button.type="button";button.id="clip-"+option.id;button.dataset.clip=option.id;
  button.setAttribute("role","tab");button.setAttribute("aria-controls","formation-panel");button.append(document.createTextNode(option.label));
  const small=document.createElement("small");small.textContent=option.detail;button.append(small);
  button.onclick=()=>{model.select(option.id);history.replaceState(null,"","#"+option.id);updateSelection();draw();};
  button.onkeydown=event=>{let next;if(["ArrowDown","ArrowRight"].includes(event.key))next=(index+1)%options.length;if(["ArrowUp","ArrowLeft"].includes(event.key))next=(index+options.length-1)%options.length;if(next===undefined)return;event.preventDefault();elements.clips.children[next].click();elements.clips.children[next].focus();};
  elements.clips.append(button);
}
elements.play.onclick=()=>{if(!model.playing && model.elapsed>=model.duration && !model.loop)model.restart();else model.playing=!model.playing;draw();};
elements.restart.onclick=()=>{model.restart();draw();};
elements.scrub.oninput=()=>{model.seek(Number(elements.scrub.value));draw();};
elements.previous.onclick=()=>{model.seek(model.elapsed-50);draw();};elements.next.onclick=()=>{model.seek(model.elapsed+50);draw();};
elements.speed.onchange=()=>{model.speed=Number(elements.speed.value);};
elements.backdrop.onchange=()=>{document.body.dataset.bg=elements.backdrop.value;};
elements["render-mode"].onchange=draw;elements.slots.onchange=draw;elements.travel.onchange=draw;
elements.repeat.onchange=()=>{model.repeat=elements.repeat.checked;if(model.repeat && !model.playing && model.elapsed>=model.duration)model.restart();};
window.addEventListener("hashchange",()=>{const id=location.hash.slice(1);if(byId.has(id)||id==="charge-sequence"){model.select(id);updateSelection();draw();}});
elements["formation-panel"].setAttribute("aria-busy","false");
elements.status.textContent="All ten formation clips loaded · five members · source actor preserved · gameplay integration pending.";
updateSelection();draw();let previous=performance.now();
function animate(now){model.advance(Math.min(100,now-previous));previous=now;draw();requestAnimationFrame(animate);}requestAnimationFrame(animate);
