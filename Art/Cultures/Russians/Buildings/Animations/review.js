const el=Object.fromEntries(["age","weapon","facing","background","speed","play","restart","frame","frame-label","catalog","status","empty"].map(k=>[k,document.getElementById(k)]));
const query=new URLSearchParams(location.search),vm={age:query.get("age")||"",weapon:query.get("weapon")||"",facing:query.get("facing")||"N",playing:true,speed:1,time:0,last:null,frame:0,request:0,ready:false};
const model={manifest:null,assets:[],cards:[],root:new URL("../",document.baseURI)};
const ages={EarlyModern:"Early Modern",Modern:"Modern"};
async function json(url){const r=await fetch(url);if(!r.ok)throw Error(r.status+" "+url);return r.json();}
async function image(url){const i=new Image();i.src=url;await i.decode();return i;}
function url(){const p=new URL(location.href);for(const key of ["age","weapon","facing"])vm[key]?p.searchParams.set(key,vm[key]):p.searchParams.delete(key);history.replaceState(null,"",p.pathname+p.search);}
const view={
card(asset){
 const card=document.createElement("article");card.className="card";card.dataset.asset=asset.id;
 const header=document.createElement("header"),h=document.createElement("h2"),sub=document.createElement("span");h.textContent=asset.label;sub.textContent=ages[asset.age]+" · Russians · "+asset.barrelCount+(asset.barrelCount===1?" barrel":" barrels");header.append(h,sub);card.append(header);
 const canvases=[];const stage=document.createElement("div");stage.className="stage";const large=this.canvas(256);large.setAttribute("aria-label",ages[asset.age]+" "+asset.label+" shooting");stage.append(large);card.append(stage);canvases.push(large);
 const samples=document.createElement("div");samples.className="samples";
 for(const size of [48,64,128]){const f=document.createElement("figure"),c=this.canvas(size),caption=document.createElement("figcaption");caption.textContent=size+" px";c.setAttribute("aria-label",asset.label+" firing at "+size+" pixels");f.append(c,caption);samples.append(f);canvases.push(c);}card.append(samples);
 const footer=document.createElement("footer");for(const [text,href] of [["Sprite sheet ↗",asset.sheetUrl],["Animation metadata ↗",asset.metadataUrl],["Source art ↗",new URL(asset.age+"/"+asset.folder+"/Icon.png",model.root).href]]){const link=document.createElement("a");link.textContent=text;link.href=href;footer.append(link);}card.append(footer);el.catalog.append(card);model.cards.push({asset,canvases});
},
canvas(cell){const c=document.createElement("canvas");c.width=c.height=Math.ceil(cell*model.manifest.framePixels/model.manifest.cellPixels);c.dataset.cell=cell;return c;},
draw(){if(!vm.ready)return;for(const card of model.cards){const clip=card.asset.metadata.animations.firing,rect=clip.frames[vm.frame%clip.frameCount];for(const c of card.canvases){const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);ctx.imageSmoothingEnabled=true;ctx.drawImage(card.asset.sheet,rect.x,rect.y,rect.width,rect.height,0,0,c.width,c.height);c.dataset.frame=String(vm.frame);c.dataset.facing=vm.facing;}}el.frame.value=String(vm.frame);el["frame-label"].textContent="Frame "+(vm.frame+1)+" / "+model.manifest.framesPerClip;}
};
async function selection(){
 const request=++vm.request;vm.ready=false;el.catalog.setAttribute("aria-busy","true");el.status.textContent="Loading selected clips…";url();
 try{const assets=model.manifest.assets.filter(a=>(!vm.age||a.age===vm.age)&&(!vm.weapon||a.folder===vm.weapon));
 const loaded=await Promise.all(assets.map(async a=>{const metadataUrl=new URL(a.facings[vm.facing],model.root),metadata=await json(metadataUrl),sheetUrl=new URL(metadata.animations.firing.file,metadataUrl);return {...a,metadata,metadataUrl:metadataUrl.href,sheetUrl:sheetUrl.href,sheet:await image(sheetUrl)};}));
 if(request!==vm.request)return;model.assets=loaded;model.cards=[];el.catalog.replaceChildren();for(const a of loaded)view.card(a);el.frame.max=String(model.manifest.framesPerClip-1);vm.frame=0;vm.time=0;vm.last=null;vm.ready=true;el.empty.hidden=loaded.length>0;el.catalog.setAttribute("aria-busy","false");el.status.textContent=loaded.length+" weapons loaded · "+vm.facing+" · firing";view.draw();
 }catch(e){if(request!==vm.request)return;el.catalog.setAttribute("aria-busy","false");el.status.textContent="Could not load firing art: "+e.message;console.error(e);}
}
for(const key of ["age","weapon","facing"]){el[key].value=vm[key];if(el[key].value!==vm[key])vm[key]=el[key].value;el[key].addEventListener("change",()=>{vm[key]=el[key].value;selection();});}
el.background.addEventListener("change",()=>{document.body.classList.remove("light","checker");if(el.background.value!=="dark")document.body.classList.add(el.background.value);});
el.speed.addEventListener("change",()=>{vm.speed=Number(el.speed.value)});
el.play.addEventListener("click",()=>{vm.playing=!vm.playing;vm.last=null;el.play.textContent=vm.playing?"Pause":"Play";});
el.frame.addEventListener("input",()=>{vm.playing=false;el.play.textContent="Play";vm.frame=Number(el.frame.value);vm.time=vm.frame/model.manifest.framesPerSecond;view.draw();});
el.restart.addEventListener("click",()=>{vm.time=0;vm.frame=0;vm.last=null;view.draw();});
function tick(now){if(vm.ready&&vm.playing){if(vm.last!==null)vm.time+=(now-vm.last)/1000*vm.speed;vm.frame=Math.floor(vm.time*model.manifest.framesPerSecond)%model.manifest.framesPerClip;view.draw();}vm.last=now;requestAnimationFrame(tick);}
try{model.manifest=await json(new URL("./manifest.json",document.baseURI));await selection();requestAnimationFrame(tick);}catch(e){el.status.textContent="Could not load animation roster: "+e.message;console.error(e);}
