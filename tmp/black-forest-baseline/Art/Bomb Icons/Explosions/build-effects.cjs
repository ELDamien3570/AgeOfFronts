// Packages AI-painted keyframes into centered one-shot game effects.
// Requires Node.js and sharp. Optional AGE_OF_FRONTS_SHARP points to sharp.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const sharp=require(process.env.AGE_OF_FRONTS_SHARP||'sharp');
sharp.cache({memory:128,files:32,items:64});
sharp.concurrency(2);
const fps=24, sourceColumns=4, sourceRows=4, threshold=8;
function hash(b){return crypto.createHash('sha256').update(b).digest('hex');}
function transparentSplits(profile,n){
 const edges=[0],span=Math.round(n/4*.28);
 for(let i=1;i<4;i++){
  const center=Math.round(n*i/4);let best=center;
  for(let p=center-span;p<=center+span;p++){
   if(profile[p]<profile[best]||(profile[p]===profile[best]&&Math.abs(p-center)<Math.abs(best-center)))best=p;
  }
  if(profile[best]>threshold)throw new Error('No transparent separator near '+center);
  edges.push(best);
 }
 edges.push(n);return edges;
}
function analyze(data,w,h){
 let left=w,top=h,right=0,bottom=0,mass=0,mx=0,my=0,maxAlpha=0,edgeAlpha=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const a=data[(y*w+x)*4+3];maxAlpha=Math.max(maxAlpha,a);
  if(x===0||y===0||x===w-1||y===h-1)edgeAlpha=Math.max(edgeAlpha,a);
  if(a>threshold){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);
   const weight=a*a;mass+=weight;mx+=x*weight;my+=y*weight;}
 }
 return {bounds:mass?[left,top,right,bottom]:null,anchor:mass?[mx/mass,my/mass]:[w/2,h/2],maxAlpha,edgeAlpha};
}
function timelinePosition(t,starts,durations){
 let k=0;while(k<15&&t>=starts[k+1])k++;
 return {k,next:Math.min(15,k+1),u:k===15?0:Math.max(0,Math.min(1,(t-starts[k])/durations[k]))};
}
async function build(job,root){
 const dir=path.join(root,job.name),framesDir=path.join(dir,'Frames');
 await fs.mkdir(framesDir,{recursive:true});
 for(const name of ['animations.json','Preview.webp','OneShot.webp']){
   try{await fs.access(path.join(dir,name));if(!job.rebuild)throw new Error('Refusing to overwrite '+path.join(dir,name));}
  catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const sourceAtlas=path.join(dir,'SourceAtlas.png');
 const meta=await sharp(job.source).metadata();
 const atlasRaw=await sharp(job.source).ensureAlpha().raw().toBuffer();
 const xProfile=new Uint8Array(meta.width),yProfile=new Uint8Array(meta.height);
 for(let y=0;y<meta.height;y++)for(let x=0;x<meta.width;x++){
  const alpha=atlasRaw[(y*meta.width+x)*4+3];
  xProfile[x]=Math.max(xProfile[x],alpha);yProfile[y]=Math.max(yProfile[y],alpha);
 }
 const xBoundaries=transparentSplits(xProfile,meta.width),yBoundaries=transparentSplits(yProfile,meta.height);
 const cells=[],sourceAudit=[];let extent=0;
 for(let i=0;i<16;i++){
  const col=i%4,row=Math.floor(i/4),left=xBoundaries[col],top=yBoundaries[row];
  const width=xBoundaries[col+1]-left,height=yBoundaries[row+1]-top;
  const {data,info}=await sharp(job.source).extract({left,top,width,height}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const stats=analyze(data,info.width,info.height);
  if(stats.edgeAlpha>threshold)throw new Error(job.name+' source keyframe '+i+' crosses its cell: alpha '+stats.edgeAlpha);
  if(i<15&&!stats.bounds)throw new Error(job.name+' source keyframe '+i+' is empty');
  if(i===15&&stats.maxAlpha>threshold)throw new Error(job.name+' final source cell is not empty');
  if(stats.bounds){const [l,t,r,b]=stats.bounds,[ax,ay]=stats.anchor;extent=Math.max(extent,ax-l,ay-t,r-ax,b-ay);}
  cells.push({data,width:info.width,height:info.height,...stats});
  sourceAudit.push({index:i,rect:{x:left,y:top,width,height},...stats});
 }
 try{
  const existing=await fs.readFile(sourceAtlas),selected=await fs.readFile(job.source);
  if(hash(existing)!==hash(selected))throw new Error('Existing source differs from selected art: '+sourceAtlas);
 }catch(e){
  if(e.code!=='ENOENT')throw e;
  await fs.copyFile(job.source,sourceAtlas,require('node:fs').constants.COPYFILE_EXCL);
 }
 const sourceCanvas=Math.ceil(2*extent/job.relativeFootprint)+12,S=job.dimension,keys=[];
 for(let i=0;i<16;i++){
  const cell=cells[i],square=Buffer.alloc(sourceCanvas*sourceCanvas*4),ax=Math.round(cell.anchor[0]),ay=Math.round(cell.anchor[1]);
  if(i<15)for(let y=0;y<cell.height;y++)for(let x=0;x<cell.width;x++){
   const dx=x-ax+Math.floor(sourceCanvas/2),dy=y-ay+Math.floor(sourceCanvas/2);
   if(dx>=0&&dy>=0&&dx<sourceCanvas&&dy<sourceCanvas)cell.data.copy(square,(dy*sourceCanvas+dx)*4,(y*cell.width+x)*4,(y*cell.width+x+1)*4);
  }
  const normalized=await sharp(square,{raw:{width:sourceCanvas,height:sourceCanvas,channels:4}}).resize(S,S,{kernel:'lanczos3'}).raw().toBuffer();
  keys.push(normalized);
 }
 const starts=[0];for(let i=0;i<15;i++)starts.push(starts[i]+job.durations[i]);
 const sourceTotal=job.durations.reduce((a,b)=>a+b,0),count=Math.ceil(sourceTotal*fps/1000);
 const frameFiles=[],frameEntries=[],encodedFrames=[],frameDurations=[];
 for(let i=0;i<count;i++){
  const t=i*sourceTotal/(count-1),pos=timelinePosition(t,starts,job.durations);
  const a=keys[pos.k],b=keys[pos.next],out=Buffer.alloc(S*S*4);
  const w1=1-pos.u,w2=pos.u,fadeStart=sourceTotal*.64;
  const opacity=t<=fadeStart?1:Math.pow(Math.max(0,1-(t-fadeStart)/(sourceTotal-fadeStart)),1.35);
  for(let p=0;p<out.length;p+=4){
   const aa=a[p+3]/255*w1,ab=b[p+3]/255*w2,alpha=aa+ab;
   if(alpha>0){for(let c=0;c<3;c++)out[p+c]=Math.round((a[p+c]*aa+b[p+c]*ab)/alpha);out[p+3]=Math.round(alpha*opacity*255);}
  }
  if(i===count-1)out.fill(0);
  const bytes=await sharp(out,{raw:{width:S,height:S,channels:4}}).png().toBuffer();
  const filename='Frame_'+String(i).padStart(3,'0')+'.png',file=path.join(framesDir,filename);
  await fs.writeFile(file,bytes,{flag:job.rebuild?'w':'wx'});
  const duration=Math.round((i+1)*1000/fps)-Math.round(i*1000/fps);
  frameFiles.push(file);encodedFrames.push(bytes);frameDurations.push(duration);
  frameEntries.push({index:i,frame:'Frames/'+filename,width:S,height:S,durationMs:duration,sha256:hash(bytes)});
 }
 const columns=S>=600?6:8,maxRows=S>=600?6:8,capacity=columns*maxRows,sheets=[];
 for(let first=0;first<count;first+=capacity){
  const number=sheets.length,last=Math.min(count,first+capacity),rows=Math.ceil((last-first)/columns);
  const file='Sheet_'+String(number).padStart(2,'0')+'.png',items=[];
  for(let i=first;i<last;i++){
   const slot=i-first,x=slot%columns*S,y=Math.floor(slot/columns)*S;
   items.push({input:encodedFrames[i],left:x,top:y});
   Object.assign(frameEntries[i],{sheet:file,x,y});
  }
  await sharp({create:{width:columns*S,height:rows*S,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(items).png().toFile(path.join(dir,file));
  sheets.push({file,width:columns*S,height:rows*S,columns,rows,firstFrame:first,frameCount:last-first});
 }
 await sharp(frameFiles,{join:{animated:true}}).webp({lossless:true,effort:4,loop:1,delay:frameDurations}).toFile(path.join(dir,'OneShot.webp'));
 const previewDelays=[...frameDurations];previewDelays[previewDelays.length-1]+=900;
 await sharp(frameFiles,{join:{animated:true}}).webp({lossless:true,effort:4,loop:0,delay:previewDelays}).toFile(path.join(dir,'Preview.webp'));
 const actualDurationMs=frameDurations.reduce((a,b)=>a+b,0);
 const manifest={schemaVersion:1,effect:job.name,label:job.label,age:'Modern',camera:'vertical-overhead-orthographic',
  frameSize:{width:S,height:S},sheetSize:{width:sheets[0].width,height:sheets[0].height},
  grid:{columns:sheets[0].columns,rows:sheets[0].rows},frameOrder:'left-to-right-then-next-row, then next sheet',
  pivot:{x:S/2,y:S/2},normalizedPivot:{x:.5,y:.5},alpha:'straight',textureLimit:4096,
  animations:{detonate:{file:sheets[0].file,files:sheets.map(s=>s.file),frameCount:count,suggestedFramesPerSecond:fps,
   loop:false,durationMs:actualDurationMs,frames:frameEntries}},sheets,
  previews:{once:'OneShot.webp',looping:'Preview.webp',loopingPauseMs:900},
  packaging:{sourceAtlas:'SourceAtlas.png',sourceGrid:{columns:4,rows:4,xBoundaries,yBoundaries},sourceFrameCount:16,sourceCanvas,
   alphaAnalysisThreshold:threshold,alignment:'opacity-weighted source anchors, fixed output center',
   interpolation:'premultiplied-alpha blend between painted keyframes',lateFade:'opacity fades to zero after 64 percent of source timeline',
   relativeFootprint:job.relativeFootprint,sourceAudit}};
 await fs.writeFile(path.join(dir,'animations.json'),JSON.stringify(manifest,null,2),{flag:job.rebuild?'w':'wx'});
 await fs.writeFile(path.join(dir,'generation-prompts.json'),JSON.stringify({generator:'built-in image_gen',...job,sourceAtlas:'SourceAtlas.png'},null,2),{flag:job.rebuild?'w':'wx'});
 console.log(JSON.stringify({effect:job.name,frameCount:count,dimension:S,sheets:sheets.length,durationMs:actualDurationMs,directory:dir}));
 return {name:job.name,label:job.label,directory:dir,frameCount:count,dimension:S,sheets:sheets.length,durationMs:actualDurationMs,generator:'built-in image_gen'};
}
(async()=>{
 const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 const built=[];
 for(const configuredJob of config.jobs){
  const job={...configuredJob,rebuild:!!config.rebuild};
  const dir=path.join(config.output,job.name);
  if(config.resume&&!config.rebuild){
   try{
    const existing=JSON.parse(await fs.readFile(path.join(dir,'animations.json'),'utf8'));
    const prompts=JSON.parse(await fs.readFile(path.join(dir,'generation-prompts.json'),'utf8'));
    if(existing.frameSize.width!==job.dimension||prompts.prompt!==job.prompt)throw new Error('Resume contract mismatch for '+job.name);
    if(hash(await fs.readFile(path.join(dir,'SourceAtlas.png')))!==hash(await fs.readFile(job.source)))throw new Error('Resume art mismatch for '+job.name);
    const anim=existing.animations.detonate;
    const item={name:job.name,label:job.label,directory:dir,frameCount:anim.frameCount,dimension:job.dimension,sheets:existing.sheets.length,durationMs:anim.durationMs,generator:'built-in image_gen'};
    built.push(item);console.log(JSON.stringify({...item,resumed:true}));continue;
   }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  built.push(await build(job,config.output));
 }
 await fs.writeFile(path.join(config.output,'Effects-Manifest.json'),JSON.stringify({generator:'built-in image_gen',frameGeneration:'painted keyframes, normalized and interpolated at 24 fps',effects:built},null,2),{flag:config.rebuild?'w':'wx'});
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
