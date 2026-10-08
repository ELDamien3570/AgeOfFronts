// Package painted overhead keyframes into game frames, sheets, and previews.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require(process.env.AGE_OF_FRONTS_SHARP || 'sharp');
sharp.cache({memory: 96, files: 16, items: 64});
sharp.concurrency(2);
const size = 627, fps = 12, threshold = 8;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function splitAt(profile, length) {
  const middle = Math.floor(length / 2), radius = Math.floor(length * .065);
  let selected = middle;
  for (let i = middle - radius; i <= middle + radius; i++) {
    if (profile[i] < profile[selected] || (profile[i] === profile[selected] && Math.abs(i-middle) < Math.abs(selected-middle))) selected = i;
  }
  if (profile[selected] > threshold) throw new Error('Source atlas has no transparent middle gutter');
  return selected;
}
function analyze(data, width, height) {
  let left=width, top=height, right=0, bottom=0, edgeAlpha=0, maxAlpha=0;
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const a=data[(y*width+x)*4+3];
    maxAlpha=Math.max(maxAlpha,a);
    if (x===0||y===0||x===width-1||y===height-1) edgeAlpha=Math.max(edgeAlpha,a);
    if (a>threshold) {left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
  }
  return {bounds:right?[left,top,right,bottom]:null,edgeAlpha,maxAlpha};
}
async function readKeys(job) {
  const {data,info}=await sharp(job.source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const xp=new Uint8Array(info.width),yp=new Uint8Array(info.height);
  for (let y=0;y<info.height;y++) for(let x=0;x<info.width;x++) {
    const a=data[(y*info.width+x)*4+3];xp[x]=Math.max(xp[x],a);yp[y]=Math.max(yp[y],a);
  }
  const xs=[0,splitAt(xp,info.width),info.width],ys=[0,splitAt(yp,info.height),info.height];
  const keys=[],audit=[];
  for(let i=0;i<4;i++) {
    const col=i%2,row=Math.floor(i/2),rect={left:xs[col],top:ys[row],width:xs[col+1]-xs[col],height:ys[row+1]-ys[row]};
    const raw=await sharp(job.source).extract(rect).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const stats=analyze(raw.data,raw.info.width,raw.info.height);
    if(!stats.bounds||stats.maxAlpha<200||stats.edgeAlpha>threshold) throw new Error(job.key+' '+job.clip+' keyframe '+i+' is empty, clipped or too faint');
    // Keep a fixed cell-center pivot. Never recenter moving crew or projectiles.
    const side=Math.max(rect.width,rect.height),square=Buffer.alloc(side*side*4);
    const dx=Math.floor((side-rect.width)/2),dy=Math.floor((side-rect.height)/2);
    for(let y=0;y<rect.height;y++) raw.data.copy(square,((y+dy)*side+dx)*4,y*rect.width*4,(y+1)*rect.width*4);
    const normalized=await sharp(square,{raw:{width:side,height:side,channels:4}}).resize(size-48,size-48,{kernel:'lanczos3'}).extend({top:24,bottom:24,left:24,right:24,background:{r:0,g:0,b:0,alpha:0}}).raw().toBuffer();
    // Clear negligible alpha noise while retaining antialiased painted edges.
    for(let p=0;p<normalized.length;p+=4) if(normalized[p+3]<=3) normalized.fill(0,p,p+4);
    const finalStats=analyze(normalized,size,size);
    if(finalStats.edgeAlpha>threshold) throw new Error('Normalized frame touches an output edge');
    keys.push(await sharp(normalized,{raw:{width:size,height:size,channels:4}}).png().toBuffer());
    audit.push({index:i,sourceRect:rect,...finalStats});
  }
  return {keys,audit,grid:{columns:2,rows:2,xBoundaries:xs,yBoundaries:ys}};
}
function timeline(unit,clip) {
  if(clip==='Idle') return [0,0,0,1,1,1,2,2,2,3,3,3];
  if(clip==='Movement') return [0,0,1,1,2,2,3,3];
  const n=['catapult','onager','trebuchet'].includes(unit.mechanism)?24:unit.mechanism==='machinegun'?12:18;
  return Array.from({length:n},(_,i)=>i<n*.25?0:i<n*.40?1:i<n*.66?2:3);
}
async function writeSheet(pngs,filename) {
  const width=6*size,height=Math.ceil(pngs.length/6)*size;
  const pixels=Buffer.alloc(width*height*4);
  for(let i=0;i<pngs.length;i++) {
    const frame=await sharp(pngs[i]).ensureAlpha().raw().toBuffer();
    const left=i%6*size,top=Math.floor(i/6)*size;
    for(let row=0;row<size;row++) frame.copy(pixels,((top+row)*width+left)*4,row*size*4,(row+1)*size*4);
  }
  await sharp(pixels,{raw:{width,height,channels:4}}).png().toFile(filename);
}
async function buildUnit(unit,root,resume,repairSheets) {
  const targetDir=path.join(root,unit.category,unit.key+'_'+unit.age);
  let dir=targetDir;
  try {
    const existing=JSON.parse(await fs.readFile(path.join(dir,'animations.json'),'utf8'));
    if(!resume) throw new Error('Refusing to overwrite '+dir);
    const prompts=JSON.parse(await fs.readFile(path.join(dir,'generation-prompts.json'),'utf8'));
    for(const job of unit.jobs) {
      const old=prompts.jobs.find(j=>j.clip===job.clip);
      if(!old||old.prompt!==job.prompt||old.source!==job.source) throw new Error('Resume contract differs for '+unit.key);
    }
    if(repairSheets) for(const clip of Object.values(existing.animations)) {
      const pngs=await Promise.all(clip.frames.map(f=>fs.readFile(path.join(dir,f.file))));
      await writeSheet(pngs,path.join(dir,clip.file));
    }
    console.log(JSON.stringify({unit:unit.key,resumed:true}));
    return {key:unit.key,label:unit.label,category:unit.category,age:unit.age,directory:path.relative(root,dir).replaceAll('\\','/'),icon:path.relative(root,path.join(dir,'Icon.png')).replaceAll('\\','/'),animations:existing.animations};
  } catch(error) {if(error.code!=='ENOENT') throw error;}
  const prepared={};
  for(const job of unit.jobs) prepared[job.clip]=await readKeys(job);
  dir=path.join(root,'_staging',unit.key+'_'+unit.age);
  const resolvedRoot=path.resolve(root)+path.sep;
  if(!path.resolve(dir).startsWith(resolvedRoot)||!path.resolve(targetDir).startsWith(resolvedRoot))throw new Error('Output paths leave the weapon workspace');
  try {await fs.access(dir);throw new Error('Existing staging folder needs inspection: '+dir);}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.mkdir(path.join(dir,'Frames'),{recursive:true});
  await fs.mkdir(path.join(dir,'SourceAtlases'),{recursive:true});
  const clips={},sourceAudit={};
  for(const job of unit.jobs) {
    const {keys,audit,grid}=prepared[job.clip],indices=timeline(unit,job.clip);
    const frames=[],files=[],pngs=[],delays=[];
    for(let i=0;i<indices.length;i++) {
      const filename=job.clip+'_'+String(i).padStart(3,'0')+'.png',relative='Frames/'+filename,file=path.join(dir,relative),bytes=keys[indices[i]];
      await fs.writeFile(file,bytes,{flag:'wx'});
      const duration=Math.round((i+1)*1000/fps)-Math.round(i*1000/fps);
      frames.push({index:i,keyframe:indices[i],file:relative,x:i%6*size,y:Math.floor(i/6)*size,width:size,height:size,durationMs:duration,sha256:hash(bytes)});
      files.push(file);pngs.push(bytes);delays.push(duration);
    }
    const columns=6,rows=Math.ceil(indices.length/columns),sheet=job.clip+'.png';
    await writeSheet(pngs,path.join(dir,sheet));
    const preview=job.clip+'-Preview.webp',loop=job.clip!=='Attack';
    const previewDelays=[...delays];if(!loop)previewDelays[previewDelays.length-1]+=700;
    await sharp(files,{join:{animated:true}}).webp({lossless:true,effort:4,loop:0,delay:previewDelays}).toFile(path.join(dir,preview));
    if(job.clip==='Attack')await sharp(files,{join:{animated:true}}).webp({lossless:true,effort:4,loop:1,delay:delays}).toFile(path.join(dir,'Attack-OneShot.webp'));
    if(job.clip==='Idle')await fs.writeFile(path.join(dir,'Icon.png'),keys[0],{flag:'wx'});
    await fs.copyFile(job.source,path.join(dir,'SourceAtlases',job.clip+'.png'),require('node:fs').constants.COPYFILE_EXCL);
    const event=job.clip==='Attack'?{frame:Math.ceil(indices.length*.25),timeMs:Math.round(Math.ceil(indices.length*.25)*1000/fps),name:unit.mechanism==='tower'?'bridge_extend':unit.mechanism==='ram'?'ram_strike':'fire'}:null;
    clips[job.clip.toLowerCase()]={file:sheet,preview,frameCount:indices.length,keyframeCount:4,suggestedFramesPerSecond:fps,loop,durationMs:delays.reduce((a,b)=>a+b,0),grid:{columns,rows},sheetSize:{width:columns*size,height:rows*size},frames,...(event?{events:[event]}:{})};
    sourceAudit[job.clip]={sourceAtlas:'SourceAtlases/'+job.clip+'.png',grid,frames:audit};
  }
  const metadata={schemaVersion:1,status:'animation-proposal',unit:unit.label,key:unit.key,category:unit.category,age:unit.age,crewCount:unit.crew,camera:'vertical-overhead-orthographic',facing:'screen-up',directionCount:1,frameSize:{width:size,height:size},pivot:{x:size/2,y:size/2},normalizedPivot:{x:.5,y:.5},alpha:'straight',textureLimit:4096,frameOrder:'left-to-right-then-next-row',animations:clips,sourceAudit,packaging:{sourceKeyframesPerClip:4,timing:'painted keyframes held for explicit frame durations',alignment:'fixed source cell centers; no per-frame mass recentering',interpolation:'none; rigid outlines stay sharp',movement:'in-place crew and weapon motion; world translation belongs to the game'}};
  await fs.writeFile(path.join(dir,'animations.json'),JSON.stringify(metadata,null,2),{flag:'wx'});
  await fs.writeFile(path.join(dir,'generation-prompts.json'),JSON.stringify({generator:'built-in image_gen',...unit},null,2),{flag:'wx'});
  await fs.mkdir(path.dirname(targetDir),{recursive:true});
  // Release cached Sharp file handles before renaming a directory on Windows.
  sharp.cache(false);
  if(process.platform==='win32') {
    await require('node:util').promisify(require('node:child_process').execFile)(process.env.AGE_OF_FRONTS_POWERSHELL||'pwsh.exe',['-NoProfile','-File',path.join(__dirname,'promote-weapon.ps1'),root,dir,targetDir]);
  } else await fs.rename(dir,targetDir);
  sharp.cache({memory:96,files:16,items:64});
  dir=targetDir;
  console.log(JSON.stringify({unit:unit.key,clips:3,frames:Object.values(clips).reduce((a,b)=>a+b.frameCount,0),directory:dir}));
  return {key:unit.key,label:unit.label,category:unit.category,age:unit.age,directory:path.relative(root,dir).replaceAll('\\','/'),icon:path.relative(root,path.join(dir,'Icon.png')).replaceAll('\\','/'),animations:clips};
}
(async()=>{
  const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  const built=[];
  for(const unit of config.units)built.push(await buildUnit(unit,config.output,!!config.resume,!!config.repairSheets));
  await fs.writeFile(path.join(config.output,'Weapon-Manifest.json'),JSON.stringify({schemaVersion:1,status:'animation-proposals',generator:'built-in image_gen',frameSize:{width:size,height:size},facing:'screen-up',directionCount:1,units:built},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
