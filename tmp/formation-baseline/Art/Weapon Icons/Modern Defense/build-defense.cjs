// Package painted RTS proposals without interpolating rigid vehicle outlines.
const fs=require('node:fs/promises'), path=require('node:path'), crypto=require('node:crypto');
const sharp=require(process.env.AGE_OF_FRONTS_SHARP||'sharp');
sharp.cache(false); sharp.concurrency(2);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'), threshold=8;
const rel=(root,p)=>path.relative(root,p).replaceAll('\\','/');
function inside(root,p){return path.resolve(p).toLowerCase().startsWith((path.resolve(root)+path.sep).toLowerCase());}
function analyze(p,w,h){
 let l=w,t=h,r=0,b=0,edge=0,max=0,mass=0,mx=0,my=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=p[(y*w+x)*4+3];max=Math.max(max,a);if(x===0||y===0||x===w-1||y===h-1)edge=Math.max(edge,a);if(a>threshold){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);const weight=a*a;mass+=weight;mx+=x*weight;my+=y*weight;}}
 return {bounds:r?[l,t,r,b]:null,edgeAlpha:edge,maxAlpha:max,anchor:mass?[mx/mass,my/mass]:[(w-1)/2,(h-1)/2]};
}
function splits(profile,n,cells){
 const out=[0],radius=Math.floor(n/cells*.16);
 for(let k=1;k<cells;k++){const mid=Math.round(n*k/cells);let best=mid;for(let p=mid-radius;p<=mid+radius;p++)if(profile[p]<profile[best]||(profile[p]===profile[best]&&Math.abs(p-mid)<Math.abs(best-mid)))best=p;if(profile[best]>threshold)throw Error('No transparent atlas gutter near '+mid);out.push(best);}
 return [...out,n];
}
async function sourceKeys(job,S){
 const {data,info}=await sharp(job.source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const cols=job.mode==='effect'?4:job.mode==='single'?1:2;
 const xp=new Uint8Array(info.width),yp=new Uint8Array(info.height);
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const a=data[(y*info.width+x)*4+3];xp[x]=Math.max(xp[x],a);yp[y]=Math.max(yp[y],a);}
 const xs=splits(xp,info.width,cols),ys=splits(yp,info.height,cols),cells=[],audit=[];
 let side=0;
 for(let i=0;i<cols*cols;i++){
  const x=i%cols,y=Math.floor(i/cols),rect={left:xs[x],top:ys[y],width:xs[x+1]-xs[x],height:ys[y+1]-ys[y]};
  const raw=await sharp(job.source).extract(rect).ensureAlpha().raw().toBuffer({resolveWithObject:true}),stats=analyze(raw.data,rect.width,rect.height);
  const blank=job.mode==='effect'&&i===15;
  if(stats.edgeAlpha>threshold)throw Error(job.key+' '+job.clip+' source '+i+' clips the cell');
  if(!blank&&(!stats.bounds||stats.maxAlpha<(job.mode==='effect'?9:80)))throw Error(job.key+' source '+i+' empty or faint');
  if(blank&&stats.maxAlpha>threshold)throw Error(job.key+' final effect cell must be blank');
  side=Math.max(side,rect.width,rect.height);cells.push({rect,data:raw.data,blank,stats});audit.push({index:i,rect,...stats});
 }
 if(job.mode==='effect')for(const cell of cells)if(cell.stats.bounds){const [l,t,r,b]=cell.stats.bounds,[ax,ay]=cell.stats.anchor;side=Math.max(side,Math.ceil(2*Math.max(ax-l,ay-t,r-ax,b-ay))+12);}
 const pad=job.mode==='effect'?12:24,keys=[];
 for(const cell of cells){
  const square=Buffer.alloc(side*side*4),dx=job.mode==='effect'?Math.round((side-1)/2-cell.stats.anchor[0]):Math.floor((side-cell.rect.width)/2),dy=job.mode==='effect'?Math.round((side-1)/2-cell.stats.anchor[1]):Math.floor((side-cell.rect.height)/2);
  if(!cell.blank)for(let y=0;y<cell.rect.height;y++){const targetY=y+dy,left=Math.max(0,-dx),right=Math.min(cell.rect.width,side-dx);if(targetY>=0&&targetY<side&&right>left)cell.data.copy(square,(targetY*side+dx+left)*4,(y*cell.rect.width+left)*4,(y*cell.rect.width+right)*4);}
  const raw=await sharp(square,{raw:{width:side,height:side,channels:4}}).resize(S-2*pad,S-2*pad,{kernel:'lanczos3'}).extend({top:pad,bottom:pad,left:pad,right:pad,background:{r:0,g:0,b:0,alpha:0}}).raw().toBuffer();
  for(let p=0;p<raw.length;p+=4)if(raw[p+3]<=3)raw.fill(0,p,p+4);
  keys.push(raw);
 }
 return {keys,audit,grid:{columns:cols,rows:cols,xBoundaries:xs,yBoundaries:ys}};
}
function blend(a,b,u,opacity){
 const out=Buffer.alloc(a.length);
 for(let p=0;p<out.length;p+=4){const aa=a[p+3]/255*(1-u),ab=b[p+3]/255*u,alpha=aa+ab;if(alpha){for(let c=0;c<3;c++)out[p+c]=Math.round((a[p+c]*aa+b[p+c]*ab)/alpha);out[p+3]=Math.round(alpha*opacity*255);if(out[p+3]<=3)out.fill(0,p,p+4);}}
 return out;
}
async function sheet(pngs,entries,first,count,S,columns,file,dir){
 const rows=Math.ceil(count/columns),width=columns*S,height=rows*S,pixels=Buffer.alloc(width*height*4);
 for(let slot=0;slot<count;slot++){
  const i=first+slot,left=slot%columns*S,top=Math.floor(slot/columns)*S,raw=await sharp(pngs[i]).ensureAlpha().raw().toBuffer();
  for(let y=0;y<S;y++)raw.copy(pixels,((top+y)*width+left)*4,y*S*4,(y+1)*S*4);
  Object.assign(entries[i],{sheet:file,x:left,y:top});
 }
 await sharp(pixels,{raw:{width,height,channels:4}}).png().toFile(path.join(dir,file));
 return {file,width,height,columns,rows,firstFrame:first,frameCount:count};
}
async function build(asset,config){
 const target=path.resolve(asset.directory),stage=path.join(config.output,'_staging',asset.key+'_Modern');
 if(!inside(config.artRoot,target)||!inside(config.output,stage))throw Error('Asset leaves art workspace');
 try{const old=JSON.parse(await fs.readFile(path.join(target,'animations.json'),'utf8')),prompts=JSON.parse(await fs.readFile(path.join(target,'generation-prompts.json'),'utf8'));if(!config.resume||JSON.stringify(prompts.jobs)!==JSON.stringify(asset.jobs))throw Error('Existing asset differs: '+asset.key);console.log(JSON.stringify({key:asset.key,resumed:true}));return {...asset,jobs:undefined,directory:rel(config.output,target),icon:rel(config.output,path.join(target,'Icon.png')),animations:old.animations};}catch(e){if(e.code!=='ENOENT')throw e;}
 const prepared={};for(const job of asset.jobs)prepared[job.clip]=await sourceKeys(job,asset.dimension);
 try{await fs.access(stage);throw Error('Inspect existing stage '+stage);}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.mkdir(path.join(stage,'Frames'),{recursive:true});await fs.mkdir(path.join(stage,'SourceArt'),{recursive:true});
 for(const job of asset.jobs)await fs.copyFile(job.source,path.join(stage,'SourceArt',job.clip+'.png'),require('node:fs').constants.COPYFILE_EXCL);
 const animations={},sourceAudit={},S=asset.dimension;
 for(const clip of asset.clips){
  let keys=[];
  for(const sourceClip of clip.sources)keys.push(...prepared[sourceClip].keys);
  const pngs=[],files=[],frames=[],delays=[],fps=clip.fps||12,N=clip.frameCount;
  const durations=clip.keyDurations||[],starts=[0];for(let i=0;i<durations.length-1;i++)starts.push(starts[i]+durations[i]);const sourceTotal=durations.reduce((a,b)=>a+b,0);
  for(let i=0;i<N;i++){
   let raw,keyframe,position;
   if(clip.interpolation==='effect'){
    const t=i*sourceTotal/(N-1);let k=0;while(k<keys.length-1&&t>=starts[k+1])k++;
    const next=Math.min(keys.length-1,k+1),u=k===keys.length-1?0:Math.max(0,Math.min(1,(t-starts[k])/durations[k]));
    const fade=clip.fadeStart||.72,opacity=t<=sourceTotal*fade?1:Math.pow(Math.max(0,1-(t-sourceTotal*fade)/(sourceTotal*(1-fade))),1.1);
    raw=i===N-1?Buffer.alloc(S*S*4):blend(keys[k],keys[next],u,opacity);keyframe=k;position=u;
   }else{keyframe=clip.timeline?clip.timeline[i]:Math.min(keys.length-1,Math.floor(i*keys.length/N));raw=keys[keyframe];}
   const stats=analyze(raw,S,S);if(stats.edgeAlpha>threshold)throw Error(asset.key+' exported frame clips');
   const bytes=await sharp(raw,{raw:{width:S,height:S,channels:4}}).png().toBuffer(),file='Frames/'+clip.name+'_'+String(i).padStart(3,'0')+'.png',duration=Math.round((i+1)*1000/fps)-Math.round(i*1000/fps);
   await fs.writeFile(path.join(stage,file),bytes,{flag:'wx'});pngs.push(bytes);files.push(path.join(stage,file));delays.push(duration);frames.push({index:i,keyframe,...(position!==undefined?{blend:position}:{}),file,width:S,height:S,durationMs:duration,sha256:hash(bytes)});
  }
  const columns=S>1000?3:S>500?6:8,rowsMax=columns,capacity=columns*rowsMax,sheets=[];
  for(let first=0;first<N;first+=capacity){const n=sheets.length,file=clip.name+'-Sheet_'+String(n).padStart(2,'0')+'.png';sheets.push(await sheet(pngs,frames,first,Math.min(capacity,N-first),S,columns,file,stage));}
  const preview=clip.name+'-Preview.webp',previewDelays=[...delays];if(!clip.loop)previewDelays[N-1]+=clip.pauseMs||900;
  await sharp(files,{join:{animated:true}}).webp({lossless:true,effort:3,loop:0,delay:previewDelays}).toFile(path.join(stage,preview));
  const once=clip.loop?null:clip.name+'-OneShot.webp';if(once)await sharp(files,{join:{animated:true}}).webp({lossless:true,effort:3,loop:1,delay:delays}).toFile(path.join(stage,once));
  if(clip===asset.clips[0]){const iconIndex=asset.type==='effect'?Math.min(N-2,Math.round(N*.2)):0;await fs.writeFile(path.join(stage,'Icon.png'),pngs[iconIndex],{flag:'wx'});if(asset.namedIcon)await fs.writeFile(path.join(stage,asset.namedIcon),pngs[iconIndex],{flag:'wx'});}
  animations[clip.name.toLowerCase()]={frameCount:N,sourceKeyframeCount:keys.length,suggestedFramesPerSecond:fps,loop:clip.loop,durationMs:delays.reduce((a,b)=>a+b,0),preview,once,previewPauseMs:clip.loop?0:clip.pauseMs||900,files:sheets.map(s=>s.file),sheets,frames,events:clip.events||[],sourceArt:clip.sources.map(s=>'SourceArt/'+s+'.png'),interpolation:clip.interpolation||'held painted poses'};
 }
 for(const job of asset.jobs)sourceAudit[job.clip]={file:'SourceArt/'+job.clip+'.png',...prepared[job.clip],keys:undefined};
 const metadata={schemaVersion:1,status:'animation-proposal',key:asset.key,label:asset.label,age:'Modern',type:asset.type,camera:'vertical-overhead-orthographic',facing:'screen-up',directionCount:1,frameSize:{width:S,height:S},pivot:{x:S/2,y:S/2},normalizedPivot:{x:.5,y:.5},alpha:'straight',textureLimit:4096,frameOrder:'row-major, then next sheet',animations,sourceAudit,links:asset.links||{},notes:asset.notes||[],packaging:{generator:'built-in image_gen',alignment:asset.type==='effect'?'opacity-squared source anchors registered to fixed output center':'fixed source cell centers; no per-frame mass recentering',rigidInterpolation:'none; painted poses held at explicit timings',effectsInterpolation:'premultiplied-alpha blending of 16 painted poses',movement:'in place; game supplies world translation'}};
 await fs.writeFile(path.join(stage,'animations.json'),JSON.stringify(metadata,null,2),{flag:'wx'});await fs.writeFile(path.join(stage,'generation-prompts.json'),JSON.stringify({generator:'built-in image_gen',jobs:asset.jobs},null,2),{flag:'wx'});
 await fs.mkdir(path.dirname(target),{recursive:true});
 if(process.platform==='win32')await require('node:util').promisify(require('node:child_process').execFile)(process.env.AGE_OF_FRONTS_POWERSHELL||'pwsh.exe',['-NoProfile','-File',path.join(__dirname,'promote-defense.ps1'),config.artRoot,stage,target]);else await fs.rename(stage,target);
 console.log(JSON.stringify({key:asset.key,clips:Object.keys(animations).length,frames:Object.values(animations).reduce((a,c)=>a+c.frameCount,0),directory:target}));
 return {...asset,jobs:undefined,clips:undefined,directory:rel(config.output,target),icon:rel(config.output,path.join(target,'Icon.png')),animations};
}
module.exports={sourceKeys};
if(require.main===module)(async()=>{const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));await fs.mkdir(config.output,{recursive:true});const assets=[];for(const asset of config.assets)assets.push(await build(asset,config));await fs.writeFile(path.join(config.output,'Defense-Manifest.json'),JSON.stringify({schemaVersion:1,status:'animation-proposals',generator:'built-in image_gen',assets},null,2));})().catch(e=>{console.error(e.stack);process.exitCode=1;});
