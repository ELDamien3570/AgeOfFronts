// Review-only MVVM: catalogs own resources, playback owns selection,
// and canvas views present artwork. Trading and movement remain game-owned.
const AGES = [
  ['Overview','All ages'], ['StoneAge','Stone Age'], ['BronzeAge','Bronze Age'],
  ['ClassicalAge','Classical Age'], ['EarlyMedieval','Early Medieval'],
  ['LateMedieval','Late Medieval'], ['EarlyModern','Early Modern'], ['Modern','Modern'],
];
class TraderAssetModel {
  constructor() {
    this.version = Date.now();
    this.metadata = new Map();
    this.cultures = [
      { id:'base', label:'Base', manifestUrl:new URL('Trader_Animation_Manifest.json',location.href) },
      { id:'russian', label:'Russian', manifestUrl:new URL('../Cultures/Russians/Traders/Trader_Animation_Manifest.json',location.href) },
    ];
  }
  versioned(url) {
    const value = new URL(url); value.searchParams.set('review',this.version); return value.href;
  }
  async json(url) {
    const response = await fetch(this.versioned(url));
    if (!response.ok) throw new Error('Artwork unavailable ('+response.status+')');
    return response.json();
  }
  async initialize() {
    await Promise.all(this.cultures.map(async culture => {
      const manifest = await this.json(culture.manifestUrl);
      culture.traderCount = manifest.traderCount; culture.clipCount = manifest.clipCount;
      culture.assets = manifest.assets.map(asset => ({
        ...asset,
        metadataUrl:asset.metadata ? new URL(asset.metadata,culture.manifestUrl) : null,
        posterUrl:asset.poster ? new URL(asset.poster,culture.manifestUrl) : null,
      }));
    }));
  }
  async load(asset,state) {
    let metadata = null, data = null, url = asset.posterUrl;
    if (asset.metadataUrl) {
      const key = asset.metadataUrl.href;
      if (!this.metadata.has(key)) this.metadata.set(key,this.json(asset.metadataUrl));
      metadata = await this.metadata.get(key);
      data = metadata.animations[state];
      if (!data || data.frameCount !== 10 || metadata.frameSize.width !== 512 || metadata.frameSize.height !== 512)
        throw new Error('Unexpected animation contract');
      url = new URL(data.file,asset.metadataUrl);
    }
    if (!url) throw new Error('Master unavailable');
    const image = new Image(); image.src = this.versioned(url); await image.decode();
    if (metadata && (image.naturalWidth !== metadata.sheetSize.width || image.naturalHeight !== metadata.sheetSize.height))
      throw new Error('Unexpected sprite sheet dimensions');
    return { image, metadata, data, url:image.src, still:!data };
  }
}
const assetModel = new TraderAssetModel();
const playback = {
  playing:true, seconds:0, frame:0, speed:1, pivot:false,
  selection:'Overview', culture:null, clips:[], revision:0, hasAnimation:false,
};
const ids = ['clips','ages','age-panel','play','previous','next','frame','frame-output',
  'speed','restart','status','review-title','culture','trader-count','manifest-link',
  'ground-scale','ground-scene','ground-zoom','compare-base','travel-ground'];
const elements = Object.fromEntries(ids.map(id => [id,document.getElementById(id)]));
const controls = ['play','previous','next','frame','speed','restart'].map(id=>elements[id]);
function frameMaster(image,size=512) {
  const extent = size*420/512, longest = Math.max(image.naturalWidth,image.naturalHeight);
  const width = extent*(image.naturalWidth/longest), height = extent*(image.naturalHeight/longest);
  return [(size-width)/2,(size-height)/2,width,height];
}
function selectFrame(frame) {
  playback.playing = false; playback.frame = (frame+10)%10; playback.seconds = 0;
  elements.play.textContent = 'Play'; elements.frame.value = playback.frame;
}
function restart() { playback.seconds = 0; playback.frame = 0; elements.frame.value = 0; }
function drawWalkingGround(context,clip) {
  if (!elements['travel-ground'].checked || clip.state!=='travel' || !clip.metadata?.walkingGroundSpeed) return;
  const seconds = playback.playing ? playback.seconds : playback.frame/clip.data.suggestedFramesPerSecond;
  const offset = seconds*clip.metadata.walkingGroundSpeed;
  context.save();
  context.fillStyle = '#34452d'; context.fillRect(158,0,196,512);
  context.strokeStyle = '#3b5034'; context.lineWidth = 4;
  context.beginPath(); context.moveTo(158,0); context.lineTo(158,512);
  context.moveTo(354,0); context.lineTo(354,512); context.stroke();
  // A following camera keeps the merchant centered. Ground travels opposite
  // the walk at the exported stance speed, so planted feet track the terrain.
  const tile = 84, start = Math.floor(offset/tile);
  for (let row=start;row<start+9;row++) {
    const y = row*tile-offset;
    context.fillStyle = '#425333';
    context.fillRect(170+((row*37)%135+135)%135,y+19,9,3);
    context.fillRect(172+((row*19)%138+138)%138,y+47,6,2);
    context.fillStyle = '#4a5536';
    context.fillRect(177+((row*13)%128+128)%128,y+67,13,2);
  }
  context.restore();
}
const canvasView = {
  create(asset,state) {
    const article = document.createElement('article'), header = document.createElement('header');
    const heading = document.createElement('h2');
    heading.textContent = asset.ageLabel+' · '+(state==='master' ? 'Static master' : state[0].toUpperCase()+state.slice(1));
    const description = document.createElement('div'); description.className = 'description'; description.textContent = asset.label;
    header.append(heading,description);
    const stage = document.createElement('div'); stage.className = 'stage';
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    canvas.setAttribute('aria-label',playback.culture.label+' '+asset.ageLabel+' '+state+(state==='master' ? '' : ' animation'));
    stage.append(canvas);
    const footer = document.createElement('footer'), link = document.createElement('a'), counter = document.createElement('span');
    link.textContent = state==='master' ? 'Open master ↗' : 'Sprite sheet ↗'; link.target = '_blank'; link.rel = 'noopener';
    counter.className = 'frame'; counter.textContent = 'Loading…';
    footer.append(link,counter); article.append(header,stage,footer); elements.clips.append(article);
    return { canvas, context:canvas.getContext('2d'), counter, link };
  },
  draw(clip) {
    const {context,image,data,counter} = clip;
    context.clearRect(0,0,512,512);
    drawWalkingGround(context,clip);
    if (clip.still) {
      context.drawImage(image,...frameMaster(image));
      counter.textContent = 'Static master · awaiting animation approval';
    } else {
      const index = playback.playing ? Math.floor(playback.seconds*data.suggestedFramesPerSecond)%data.frameCount : playback.frame;
      clip.currentFrame = index; const frame = data.frames[index];
      context.drawImage(image,frame.x,frame.y,frame.width,frame.height,0,0,512,512);
      counter.textContent = (index+1)+' / '+data.frameCount;
    }
    if (playback.pivot) {
      const pivot = clip.metadata?.pivot ?? {x:256,y:256};
      context.strokeStyle = '#f4d97d'; context.lineWidth = 1; context.beginPath();
      context.moveTo(pivot.x-12,pivot.y); context.lineTo(pivot.x+12,pivot.y);
      context.moveTo(pivot.x,pivot.y-12); context.lineTo(pivot.x,pivot.y+12); context.stroke();
    }
  },
};
class GroundTraderScaleView {
  constructor() { this.atlases = new WeakMap(); this.base = new Map(); }
  atlas(clip) {
    let frames = this.atlases.get(clip.image);
    if (!frames) { frames = new Map(); this.atlases.set(clip.image,frames); }
    const key = clip.still ? 'master' : clip.currentFrame ?? 0;
    if (frames.has(key)) return frames.get(key);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high';
    if (clip.still) context.drawImage(clip.image,...frameMaster(clip.image,128));
    else {
      const frame = clip.data.frames[key];
      context.drawImage(clip.image,frame.x,frame.y,frame.width,frame.height,0,0,128,128);
    }
    frames.set(key,canvas); return canvas;
  }
  setClips(clips) {
    const selected = new Map();
    for (const clip of clips) {
      if (!selected.has(clip.asset.age) || clip.state==='travel') selected.set(clip.asset.age,clip);
    }
    this.clips = [...selected.values()];
    const baseCulture = assetModel.cultures.find(c=>c.id==='base');
    for (const clip of this.clips) {
      if (!baseCulture.assets.some(a=>a.age===clip.asset.age) || this.base.has(clip.asset.age)) continue;
      const image = new Image();
      image.src = assetModel.versioned(new URL(clip.asset.age+'/Source_Transparent.png',baseCulture.manifestUrl));
      this.base.set(clip.asset.age,image);
    }
    elements['ground-scale'].hidden = playback.culture.id!=='russian' || !this.clips.length;
  }
  draw() {
    if (elements['ground-scale'].hidden) return;
    const canvas = elements['ground-scene'], width = Math.max(320,canvas.clientWidth);
    const height = elements['compare-base'].checked ? 390 : 210, ratio = window.devicePixelRatio || 1;
    if (canvas.width!==Math.round(width*ratio) || canvas.height!==Math.round(height*ratio)) {
      canvas.width = Math.round(width*ratio); canvas.height = Math.round(height*ratio); canvas.style.height = height+'px';
    }
    const context = canvas.getContext('2d'); context.setTransform(ratio,0,0,ratio,0,0);
    context.fillStyle = '#283d2b'; context.fillRect(0,0,width,height);
    context.textAlign = 'center'; context.font = '600 13px system-ui'; context.fillStyle = '#edf1e9';
    // MapSymbols.traderSymbol: land cap 44; EraArtwork sprite extent 4/3.
    const size = Math.min(44,Number(elements['ground-zoom'].value)*2)*4/3;
    const column = width/this.clips.length;
    this.clips.forEach((clip,index) => {
      const x = (index+0.5)*column;
      context.fillText(clip.asset.ageLabel,x,25);
      context.save(); context.globalAlpha = 0.85;
      context.drawImage(this.atlas(clip),x-size/2,105-size/2,size,size); context.restore();
      context.font = '12px system-ui';
      context.fillText('Russian · '+(clip.still ? 'master' : clip.state)+' · '+Math.round(size)+' px frame',x,190);
      if (elements['compare-base'].checked) {
        const image = this.base.get(clip.asset.age);
        if (image?.complete && image.naturalWidth) {
          context.save(); context.globalAlpha = 0.85;
          context.drawImage(this.atlas({image,still:true}),x-size/2,285-size/2,size,size); context.restore();
          context.fillText('Base · still',x,376);
        } else context.fillText(image ? 'Base loading…' : 'Base artwork not authored',x,376);
      }
      context.font = '600 13px system-ui';
    });
  }
}
const groundView = new GroundTraderScaleView();
async function selectAge(selection,updateLocation=true) {
  const revision = ++playback.revision; playback.selection = selection; playback.clips = []; playback.hasAnimation = false; restart();
  controls.forEach(control=>control.disabled=true); groundView.setClips([]);
  const overview = selection==='Overview', culture = playback.culture;
  const selectedAssets = overview ? culture.assets : culture.assets.filter(asset=>asset.age===selection);
  document.body.classList.toggle('single-age',!overview);
  const ageLabel = AGES.find(([age])=>age===selection)?.[1] ?? 'All ages';
  const label = culture.label+' · '+ageLabel+' · Overland Traders';
  elements['review-title'].textContent = label; document.title = label;
  elements['trader-count'].textContent = culture.traderCount+' traders · '+culture.clipCount+' clips · transparent PNG';
  elements['manifest-link'].href = culture.manifestUrl.href;
  elements['age-panel'].setAttribute('aria-labelledby','tab-'+selection); elements['age-panel'].setAttribute('aria-busy','true');
  for (const tab of elements.ages.children) { const active = tab.dataset.age===selection; tab.setAttribute('aria-selected',String(active)); tab.tabIndex = active ? 0 : -1; }
  if (updateLocation) {
    const url = new URL(location.href); url.hash = selection;
    if (culture.id==='base') url.searchParams.delete('culture'); else url.searchParams.set('culture',culture.id);
    history.replaceState(null,'',url);
  }
  elements.clips.replaceChildren(); elements.status.textContent = 'Loading trader artwork…';
  let failed = 0;
  const requests = selectedAssets.flatMap(asset=>(asset.metadataUrl ? overview ? ['travel'] : ['idle','travel'] : ['master'])
    .map(state=>({asset,state,view:canvasView.create(asset,state)})));
  document.body.classList.toggle('pair',requests.length===2);
  const loaded = new Array(requests.length);
  await Promise.all(requests.map(async ({asset,state,view},index)=>{
    try {
      const resource = await assetModel.load(asset,state); if (revision!==playback.revision) return;
      view.link.href = resource.url; loaded[index] = {...view,...resource,asset,state};
    } catch (error) { if (revision!==playback.revision) return; view.counter.textContent = error.message; failed++; }
  }));
  if (revision!==playback.revision) return;
  playback.clips = loaded.filter(Boolean);
  playback.hasAnimation = playback.clips.some(clip=>!clip.still);
  elements['travel-ground'].disabled = !playback.clips.some(clip=>clip.metadata?.walkingGroundSpeed);
  controls.forEach(control=>control.disabled=!playback.hasAnimation);
  elements.play.textContent = playback.hasAnimation && playback.playing ? 'Pause' : 'Play';
  elements['age-panel'].setAttribute('aria-busy','false');
  const stills = playback.clips.filter(clip=>clip.still).length, animations = playback.clips.length-stills;
  elements.status.textContent = !requests.length
    ? culture.label+' · '+ageLabel+': no trader artwork authored for this age.'
    : culture.label+': '+animations+' animations and '+stills+' static masters loaded'+(failed ? ' · '+failed+' failed' : '')+
      (stills ? ' · Static masters await animation approval.' : ' · Idle at 8 fps · travel at 12 fps.')+' · overhead, facing down';
  groundView.setClips(playback.clips);
}
elements.culture.addEventListener('change',()=>{
  playback.culture = assetModel.cultures.find(c=>c.id===elements.culture.value); selectAge(playback.selection);
});
elements.play.addEventListener('click',()=>{
  if (!playback.playing) playback.seconds = playback.frame/12;
  playback.playing = !playback.playing; elements.play.textContent = playback.playing ? 'Pause' : 'Play';
});
elements.frame.addEventListener('input',()=>selectFrame(Number(elements.frame.value)));
elements.previous.addEventListener('click',()=>selectFrame(playback.frame-1));
elements.next.addEventListener('click',()=>selectFrame(playback.frame+1));
elements.restart.addEventListener('click',restart);
elements.speed.addEventListener('change',event=>{playback.speed=Number(event.target.value);});
document.getElementById('size').addEventListener('change',event=>{
  const size=Number(event.target.value); document.documentElement.style.setProperty('--sprite-size',size+'px'); document.body.classList.toggle('large',size>256);
});
document.getElementById('background').addEventListener('change',event=>{
  for (const value of ['checker','white','dark']) document.body.classList.toggle(value,event.target.value===value);
});
document.getElementById('pivot').addEventListener('change',event=>{playback.pivot=event.target.checked;});
elements.ages.addEventListener('keydown',event=>{
  const tabs=[...elements.ages.children]; let index=tabs.indexOf(document.activeElement);
  if (index<0 || !['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
  event.preventDefault(); index=event.key==='Home' ? 0 : event.key==='End' ? tabs.length-1 : (index+(event.key==='ArrowRight' ? 1 : -1)+tabs.length)%tabs.length;
  tabs[index].focus(); selectAge(tabs[index].dataset.age);
});
window.addEventListener('hashchange',()=>{
  const requested=location.hash.slice(1); selectAge(AGES.some(([age])=>age===requested) ? requested : 'Overview',false);
});
let previousTime;
function render(time) {
  if (previousTime!==undefined && playback.playing && playback.hasAnimation) playback.seconds+=Math.min((time-previousTime)/1000,.1)*playback.speed;
  previousTime=time;
  if (playback.playing && playback.hasAnimation) playback.frame=Math.floor(playback.seconds*12)%10;
  elements.frame.value=playback.frame; elements['frame-output'].textContent=playback.hasAnimation ? (playback.frame+1)+' / 10' : 'Static';
  for (const clip of playback.clips) canvasView.draw(clip);
  groundView.draw(); requestAnimationFrame(render);
}
assetModel.initialize().then(()=>{
  for (const culture of assetModel.cultures) {
    const option=document.createElement('option'); option.value=culture.id; option.textContent=culture.label; elements.culture.append(option);
  }
  playback.culture=assetModel.cultures.find(c=>c.id===new URL(location.href).searchParams.get('culture')) ?? assetModel.cultures[0];
  elements.culture.value=playback.culture.id;
  for (const [age,label] of AGES) {
    const tab=document.createElement('button'); tab.type='button'; tab.id='tab-'+age; tab.dataset.age=age; tab.textContent=label;
    tab.setAttribute('role','tab'); tab.setAttribute('aria-controls','age-panel'); tab.addEventListener('click',()=>selectAge(age)); elements.ages.append(tab);
  }
  const requested=location.hash.slice(1); selectAge(AGES.some(([age])=>age===requested) ? requested : 'Overview',false);
  requestAnimationFrame(render);
}).catch(error=>{
  elements.status.textContent='Could not load traders: '+error.message; elements['age-panel'].setAttribute('aria-busy','false');
});
