const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require(process.env.STONE_MASK_IMAGE_LIB || 'C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const root = path.resolve(__dirname,'../../../../../..');
const ageDir = path.dirname(__dirname);
const settings = {Clubman:{minArea:100},Javelinist:{minArea:35},MountedSpearman:{minArea:22},Scout:{minArea:22}};
const colors = {blue:[45,105,245],green:[45,185,85],purple:[180,75,235],white:[235,235,235]};
const hash = b=>crypto.createHash('sha256').update(b).digest('hex');
const relative = p=>path.relative(__dirname,p).replaceAll('\\','/');
function material(r,g,b,a) {
  if(!a || r<12 || r<=Math.max(g,b))return 0;
  const hue=(g-b)/(r-Math.min(g,b))/6;
  if(hue<-.035 || hue>.04)return 0;
  return Math.max(0,Math.min(1,(.66-g/r)/.18));
}
function selectMask(data,width,height,frames,unit) {
  const candidate=Buffer.alloc(width*height),kept=Buffer.alloc(width*height),seen=new Uint8Array(width*height);
  for(let p=0;p<candidate.length;p++)candidate[p]=Math.round(material(...data.subarray(p*4,p*4+4))*255);
  const stats=[];
  for(const frame of frames) {
    const scale=frame.width/128,minArea=settings[unit].minArea*scale*scale;
    const components=[];
    for(let y=frame.y;y<frame.y+frame.height;y++)for(let x=frame.x;x<frame.x+frame.width;x++) {
      const p=y*width+x;if(seen[p]||candidate[p]<128)continue;
      const q=[p];seen[p]=1;
      for(let k=0;k<q.length;k++) {
        const s=q[k],px=s%width,py=Math.floor(s/width);
        for(const [nx,ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]) {
          if(nx<frame.x||nx>=frame.x+frame.width||ny<frame.y||ny>=frame.y+frame.height)continue;
          const n=ny*width+nx;if(!seen[n]&&candidate[n]>=128){seen[n]=1;q.push(n);}
        }
      }
      components.push(q);
    }
    const panels=components.filter(q=>q.length>=minArea);
    const cap=panels.toSorted((a,b)=>b.length-a.length)[0];
    const top=cap?Math.min(...cap.map(p=>Math.floor(p/width))):0;
    const center=cap?cap.reduce((n,p)=>n+p%width,0)/cap.length:frame.x+frame.width/2;
    const accepted=components.filter(q=>q.length>=minArea||(unit==='Clubman'&&q.length>=6*scale*scale&&q.every(p=>Math.floor(p/width)<top&&Math.floor(p/width)>=top-18*scale&&Math.abs(p%width-center)<13*scale)));
    const radius=1;
    for(const q of accepted)for(const p of q){const x=p%width,y=Math.floor(p/width);for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const nx=x+dx,ny=y+dy;if(nx<frame.x||nx>=frame.x+frame.width||ny<frame.y||ny>=frame.y+frame.height)continue;const n=ny*width+nx;kept[n]=candidate[n];}}
    let selected=0;for(let y=frame.y;y<frame.y+frame.height;y++)for(let x=frame.x;x<frame.x+frame.width;x++)if(kept[y*width+x])selected++;
    if(!selected)throw Error(`${unit}: frame has no selected fabric`);
    stats.push({selectedPixels:selected,panels:accepted.map(q=>q.length)});
  }
  for(let p=0;p<kept.length;p++)if(kept[p]&&!data[p*4+3])throw Error('Mask extends into transparent background');
  return {mask:kept,stats};
}
async function sourceMask(data,info,frames,unit) {
  const mask=Buffer.alloc(info.width*info.height),stats=[];
  // Coarse region isolation prevents source-scale red cuff/skin bridges;
  // source-pixel chroma supplies the final native-resolution boundaries.
  for(const frame of frames) {
    const raw=await sharp(data,{raw:info}).extract({left:frame.x,top:frame.y,width:frame.width,height:frame.height}).resize(128,128).raw().toBuffer();
    const region=selectMask(raw,128,128,[{x:0,y:0,width:128,height:128}],unit).mask;
    const gate=await sharp(region,{raw:{width:128,height:128,channels:1}}).resize(frame.width,frame.height,{kernel:'nearest'}).raw().toBuffer({resolveWithObject:true});
    let selected=0;
    for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
      const p=(y+frame.y)*info.width+x+frame.x;
      if(gate.data[(y*frame.width+x)*gate.info.channels])mask[p]=Math.round(material(...data.subarray(p*4,p*4+4))*255);
      if(mask[p])selected++;
    }
    if(!selected)throw Error(`${unit}: source frame has no fabric`);
    stats.push({selectedPixels:selected});
  }
  return {mask,stats};
}
function recolor(data,mask,color) {
  const out=Buffer.from(data),maximum=Math.max(...color);
  for(let p=0;p<mask.length;p++)if(mask[p]){const i=p*4,m=mask[p]/255,value=Math.max(data[i],data[i+1],data[i+2]);for(let c=0;c<3;c++)out[i+c]=Math.round(data[i+c]*(1-m)+color[c]*value/maximum*m);}
  for(let p=0;p<mask.length;p++){const i=p*4;if(out[i+3]!==data[i+3])throw Error('Alpha changed');if(!mask[p]&&!out.subarray(i,i+4).equals(data.subarray(i,i+4)))throw Error('Unmasked pixel changed');}
  return out;
}
async function strip(png,frames,size=128) {
  const tiles=await Promise.all(frames.map(async(f,index)=>({input:await sharp(png).extract({left:f.x,top:f.y,width:f.width,height:f.height}).resize(size,size).png().toBuffer(),left:index*size,top:0})));
  return sharp({create:{width:frames.length*size,height:size,channels:4,background:'#20242b'}}).composite(tiles).png().toBuffer();
}
(async()=>{
  const index={age:'StoneAge',status:'awaiting visual review; no game integration',encoding:'8-bit grayscale coverage; keep original sprite alpha',units:[],checks:['source hashes unchanged','matching source dimensions','no mask in transparent pixels','preview alpha unchanged','unmasked preview pixels byte-identical']};
  const overview=[];
  for(const unit of Object.keys(settings)) {
    const unitRecord={unit,selection:unit==='MountedSpearman'?'red cap, sleeves, tunic, and red saddle panel (user confirmed); retain fur, neutral trousers, skin, other leather, weapons and horse':'red woven cap, sleeves, tunic; retain fur, neutral trousers, skin, leather, weapons and horse',datasets:[]};
    for(const kind of ['source','runtime']) {
      const dir=kind==='source'?path.join(ageDir,unit):path.join(root,'Art/Runtime/Russians/Troops/StoneAge-'+unit);
      let manifest;try{manifest=JSON.parse(await fs.readFile(path.join(dir,'animations.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;unitRecord.runtimeStatus='No runtime set exists; source-only review';continue;}
      const record={kind,clips:[]};
      const dest=path.join(__dirname,unit,kind);await fs.mkdir(dest,{recursive:true});
      const contact=[];
      for(const clip of manifest.animations) {
        const source=path.join(dir,clip.file),bytes=await fs.readFile(source),beforeHash=hash(bytes);
        const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        const {mask,stats}=kind==="source" ? await sourceMask(data,info,clip.frames,unit) : selectMask(data,info.width,info.height,clip.frames,unit);
        const maskFile=path.join(dest,clip.id+'.fabric-mask.png');
        await sharp(mask,{raw:{width:info.width,height:info.height,channels:1}}).png().toFile(maskFile);
        const variants={};let blue;
        for(const [name,color]of Object.entries(colors)){
          const png=await sharp(recolor(data,mask,color),{raw:info}).png().toBuffer();
          const file=path.join(dest,clip.id+'.'+name+'.preview.png');await fs.writeFile(file,png);variants[name]=relative(file);if(name==='blue')blue=png;
        }
        if(beforeHash!==hash(await fs.readFile(source)))throw Error('Source changed');
        record.clips.push({id:clip.id,label:clip.label||clip.id,source:relative(source),sourceSha256:beforeHash,mask:relative(maskFile),width:info.width,height:info.height,frames:clip.frames,durations:clip.durations||clip.frames.map(()=>1000/(clip.fps||6)),loop:!!clip.loop,variants,stats});
        const originalStrip=await strip(bytes,clip.frames),blueStrip=await strip(blue,clip.frames);
        const label=Buffer.from(`<svg width="768" height="24"><rect width="768" height="24" fill="#20242b"/><text x="10" y="17" fill="white" font-family="sans-serif" font-size="14">${unit} / ${kind} / ${clip.id}: original then blue</text></svg>`);
        contact.push({input:label,left:0,top:(contact.length/3)*280});
        contact.push({input:originalStrip,left:0,top:(contact.length-1)/3*280+24});
        contact.push({input:blueStrip,left:0,top:(contact.length-2)/3*280+152});
        if(kind==='source'&&clip.id==='idle'){
          const frame=clip.frames[0];
          const variantsPng=[bytes,...await Promise.all(Object.values(variants).map(v=>fs.readFile(path.join(__dirname,v))))];
          const tiles=await Promise.all(variantsPng.map(async(png,k)=>({input:await sharp(png).extract({left:frame.x,top:frame.y,width:frame.width,height:frame.height}).resize(192,192).png().toBuffer(),left:k*192,top:overview.length/5*224+32})));
          const heading=Buffer.from(`<svg width="960" height="32"><rect width="960" height="32" fill="#20242b"/><text x="10" y="22" fill="white" font-family="sans-serif" font-size="18">${unit} - Original / Blue / Green / Purple / White</text></svg>`);
          overview.push({input:heading,left:0,top:overview.length/6*224},...tiles);
        }
      }
      await sharp({create:{width:768,height:record.clips.length*280,channels:4,background:'#20242b'}}).composite(contact).png().toFile(path.join(dest,'Motion-Review.png'));
      unitRecord.datasets.push(record);
    }
    index.units.push(unitRecord);
  }
  // Overview rows contain one heading plus five thumbnails.
  overview.forEach((item,i)=>{item.top=Math.floor(i/6)*224+(i%6===0?0:32)});
  await sharp({create:{width:960,height:index.units.length*224,channels:4,background:'#20242b'}}).composite(overview).png().toFile(path.join(__dirname,'StoneAge-Color-Review.png'));
  await fs.writeFile(path.join(__dirname,'Validation.json'),JSON.stringify(index,null,2)+'\n');
  console.log(JSON.stringify(index.units.map(u=>({unit:u.unit,datasets:u.datasets.map(d=>({kind:d.kind,sheets:d.clips.length})),runtimeStatus:u.runtimeStatus}))));
})().catch(e=>{console.error(e);process.exitCode=1});

