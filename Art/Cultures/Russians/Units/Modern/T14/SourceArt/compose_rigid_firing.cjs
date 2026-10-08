// Bake a sprite animation from one immutable approved tank plus moving texture/VFX layers.
const {chromium}=require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8').replace(/^\uFEFF/,''));
const write=(name,v)=>fs.writeFileSync(path.join(root,name),JSON.stringify(v,null,2)+'\n');
const sha=name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
(async()=>{
 const before=read('animations.json');
 const untouched=before.animations.filter(c=>c.id!=='moving-shooting').map(c=>[c.file,sha(c.file)]);
 const master='idle-Registered-v1.png', effects='SourceArt/Native-muzzle-effects-v1.png';
 const masterHash=sha(master);
 const browser=await chromium.launch({headless:true,channel:'chrome',args:['--disable-gpu']});
 try {
 const page=await browser.newPage();
 const encoded={master:fs.readFileSync(path.join(root,master)).toString('base64'),effects:fs.readFileSync(path.join(root,effects)).toString('base64')};
 const result=await page.evaluate(async encoded=>{
  const load=async s=>{const i=new Image();i.src='data:image/png;base64,'+s;await i.decode();return i;};
  const master=await load(encoded.master),effects=await load(encoded.effects);
  const atlas=document.createElement('canvas');atlas.width=1536;atlas.height=1024;
  const atlasContext=atlas.getContext('2d');
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(master,0,0);
  const baseline=ctx.getImageData(0,0,512,512).data;
  // Texture motion stays inside the opaque inner tread strips. Outer track silhouette is untouched.
  const tracks=[{x:166,y:84,w:7,h:300},{x:339,y:84,w:7,h:300}];
  const period=12;
  const tiles=tracks.map(t=>{const tile=document.createElement('canvas');tile.width=t.w;tile.height=period;tile.getContext('2d').drawImage(master,t.x,108,t.w,period,0,0,t.w,period);return tile;});
  const records=[];
  const widths=data=>[100,140,180,220,260,300,340,380].map(y=>{
    const xs=[];for(let x=0;x<512;x++)if(data[(y*512+x)*4+3]>128)xs.push(x);
    return xs.length?xs[xs.length-1]-xs[0]+1:0;
  });
  const referenceWidths=widths(baseline);
  for(let frame=0;frame<6;frame++){
    ctx.clearRect(0,0,512,512);ctx.drawImage(master,0,0);
    tracks.forEach((t,k)=>{
      ctx.save();ctx.beginPath();ctx.rect(t.x,t.y,t.w,t.h);ctx.clip();
      for(let y=t.y-period+(frame*2)%period;y<t.y+t.h;y+=period)ctx.drawImage(tiles[k],t.x,y);
      ctx.restore();
    });
    if(frame>0){
      const size=frame===1?64:70;
      ctx.save();ctx.globalAlpha=[0,1,.65,.40,.22,.10][frame];
      ctx.drawImage(effects,(frame%3)*512,Math.floor(frame/3)*512,512,512,256-size/2,(frame===1?448:460)-size/2,size,size);
      ctx.restore();
    }
    const data=ctx.getImageData(0,0,512,512).data;
    let changedOutsideLayers=0;const examples=[];
    for(let y=0;y<512;y++)for(let x=0;x<512;x++){
      if(tracks.some(t=>x>=t.x&&x<t.x+t.w&&y>=t.y&&y<t.y+t.h)||(x>=220&&x<292&&y>=415&&y<496))continue;
      const o=(y*512+x)*4;
      if(data[o]!==baseline[o]||data[o+1]!==baseline[o+1]||data[o+2]!==baseline[o+2]||data[o+3]!==baseline[o+3]){changedOutsideLayers++;if(examples.length<5)examples.push([x,y,...data.slice(o,o+4),...baseline.slice(o,o+4)]);}
    }
    const bodyWidths=widths(data);
    if(changedOutsideLayers||JSON.stringify(bodyWidths)!==JSON.stringify(referenceWidths))throw new Error('Rigid sprite invariant failed at frame '+frame+'; outside='+changedOutsideLayers+' examples='+JSON.stringify(examples)+' widths='+JSON.stringify(bodyWidths)+' reference='+JSON.stringify(referenceWidths));
    atlasContext.drawImage(canvas,(frame%3)*512,Math.floor(frame/3)*512);
    records.push({frame,bodyWidths,changedOutsideLayers,phase:frame*2});
  }
  return {png:atlas.toDataURL('image/png').split(',')[1],records,tracks,referenceWidths};
 },encoded);
 const output='moving-shooting-Registered-v2.png';fs.writeFileSync(path.join(root,output),Buffer.from(result.png,'base64'));
 const meta=read('animations.json');const clip=meta.animations.find(c=>c.id==='moving-shooting');
 clip.file=output;clip.sha256=sha(output);clip.description='One fixed approved tank. Tread textures advance inside unchanged track outlines; one cannon flash and fading smoke are separate layers. No hull, turret or weapon resizing.';
 meta.artRevision='rigid-firing-v2';write('animations.json',meta);
 const recipe={method:'Deterministic sprite-layer animation: one immutable master, clipped tread texture motion, independent generated muzzle VFX.',master,masterSha256:masterHash,effects,effectsSha256:sha(effects),output,outputSha256:sha(output),...result};delete recipe.png;
 write('SourceArt/Rigid-Firing-Composition.json',recipe);
 const validation=read('Validation.json');validation.rigidFiring={frameCount:6,bodyWidths:result.referenceWidths,allSixFramesHaveIdenticalBodyWidths:true,bodyPixelsOutsideAnimationLayersUnchanged:true,perFrameScaling:false};write('Validation.json',validation);
 if(sha(master)!==masterHash||untouched.some(([file,hash])=>sha(file)!==hash))throw new Error('Unrelated clip changed');
 console.log('Six rigid firing frames: identical width at eight hull cross-sections; all pixels outside tread/VFX layers identical; idle/moving/death unchanged.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
