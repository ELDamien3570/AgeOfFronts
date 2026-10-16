// Reduce only the carrier/FPV sources to the existing 128-pixel runtime artwork contract.
const fs=require('node:fs/promises'),path=require('node:path');
const sharp=require(process.env.AGE_OF_FRONTS_SHARP||'sharp');
const {createCanvas,loadImage}=require(process.env.AGE_OF_FRONTS_CANVAS||'@napi-rs/canvas');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),culture=path.join(root,'Art/Cultures/Russians'),out=path.join(root,'Art/Runtime/Russians');
async function main(){
  const manifest=JSON.parse(await fs.readFile(path.join(out,'manifest.json'),'utf8'));
  const {renderClip}=await import(pathToFileURL(path.join(culture,'modern-naval-air-renderer.mjs')));
  const sources={carrier:'Ships/Modern/Carrier/SourceArt/Carrier_Russian_EmptyDeck_v1.png',drone:'Aircraft/Modern/FPVDrone/SourceArt/FPVDrone_Russian_Modern_v1.png',droneBody:'Aircraft/Modern/FPVDrone/SourceArt/FPVDrone_Body_v1.png'};
  const images=Object.fromEntries(await Promise.all(Object.entries(sources).map(async([key,file])=>[key,await loadImage(path.join(culture,file))])));
  for(const [kind,id,names] of [['carrier','earlymodern-carrier',['Idle','Sailing']],['drone','drone',['Idle','Hover','Flight']]]){
    const clips={};
    for(const clip of names){
      const canvas=createCanvas(640,512),ctx=canvas.getContext('2d');
      for(let i=0;i<20;i++){ctx.save();ctx.translate(i%5*128,Math.floor(i/5)*128);renderClip(ctx,images,kind,clip,i,128);ctx.restore();}
      const file=`${id}-${clip.toLowerCase()}.png`;await fs.writeFile(path.join(out,file),canvas.toBuffer('image/png'));
      clips[clip.toLowerCase()]={file,frames:20,columns:5,fps:20,loop:true};
      if(clip==='Idle')await sharp(canvas.toBuffer('image/png')).extract({left:0,top:0,width:128,height:128}).toFile(path.join(out,`${id}-portrait.png`));
    }
    manifest[id]={poster:`${id}-portrait.png`,facing:'screen-up',clips};
  }
  const directory=path.join(culture,'Aircraft/Modern/FPVDrone/Explosion');
  const metadata=JSON.parse(await fs.readFile(path.join(directory,'animations.json'),'utf8'));
  const pixels=Buffer.alloc(1024*640*4);
  for(const frame of metadata.animations.detonate.frames){
    const raw=await sharp(path.join(directory,frame.file)).resize(128,128).ensureAlpha().raw().toBuffer();
    const left=frame.index%8*128,top=Math.floor(frame.index/8)*128;
    for(let y=0;y<128;y++)raw.copy(pixels,((top+y)*1024+left)*4,y*128*4,(y+1)*128*4);
  }
  await sharp(pixels,{raw:{width:1024,height:640,channels:4}}).png().toFile(path.join(out,'impact-fpv-drone-detonate.png'));
  manifest['impact-fpv-drone']={facing:'screen-up',clips:{detonate:{file:'impact-fpv-drone-detonate.png',frames:36,columns:8,fps:24,loop:false}}};
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log('Prepared carrier, FPV drone and explosion runtime artwork. Other manifest entries preserved.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
