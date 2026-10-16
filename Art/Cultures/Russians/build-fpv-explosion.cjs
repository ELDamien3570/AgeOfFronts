// Package generated explosion keyframes using the existing Modern Defense alpha/registration contract.
// AGE_OF_FRONTS_SHARP may point to the bundled sharp package.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require(process.env.AGE_OF_FRONTS_SHARP || 'sharp');
const { sourceKeys } = require('../../Weapon Icons/Modern Defense/build-defense.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const folder = path.join(__dirname,'Aircraft/Modern/FPVDrone/Explosion');
const SIZE = 314, COUNT = 36, FPS = 24, COLUMNS = 8;

function blend(a,b,t) {
  const out = Buffer.alloc(a.length);
  for(let p=0;p<out.length;p+=4) {
    const aa=a[p+3]*(1-t), ab=b[p+3]*t, alpha=aa+ab;
    if(alpha>3) {
      for(let c=0;c<3;c++) out[p+c]=Math.round((a[p+c]*aa+b[p+c]*ab)/alpha);
      out[p+3]=Math.round(alpha);
    }
  }
  return out;
}

async function main() {
  const source = path.join(folder,'SourceArt/Detonate.png');
  const {keys,audit,grid} = await sourceKeys({source,mode:'effect',key:'FPVDroneExplosion',clip:'Detonate'},SIZE);
  const times=[0,.025,.05,.085,.13,.18,.24,.31,.40,.49,.58,.67,.76,.84,.92,1];
  const sheetWidth=COLUMNS*SIZE, sheetHeight=Math.ceil(COUNT/COLUMNS)*SIZE;
  const sheet=Buffer.alloc(sheetWidth*sheetHeight*4), frames=[], files=[], delays=[];
  await fs.mkdir(path.join(folder,'Frames'),{recursive:true});
  let peakAlpha=0;
  for(let i=0;i<COUNT;i++) {
    const t=i/(COUNT-1);let key=0;
    while(key<14 && t>=times[key+1]) key++;
    const mix=Math.max(0,Math.min(1,(t-times[key])/(times[key+1]-times[key])));
    const pixels=i===COUNT-1?Buffer.alloc(SIZE*SIZE*4):blend(keys[key],keys[key+1],mix);
    let maxAlpha=0,edgeAlpha=0;
    for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++) {
      const a=pixels[(y*SIZE+x)*4+3];maxAlpha=Math.max(maxAlpha,a);
      if(x===0||y===0||x===SIZE-1||y===SIZE-1) edgeAlpha=Math.max(edgeAlpha,a);
    }
    if(edgeAlpha) throw new Error(`Clipped effect border at frame ${i}`);
    if(i===COUNT-1 && maxAlpha) throw new Error('Terminal frame is not transparent');
    if(i===0 && !maxAlpha) throw new Error('Ignition frame is empty');
    peakAlpha=Math.max(peakAlpha,maxAlpha);
    const bytes=await sharp(pixels,{raw:{width:SIZE,height:SIZE,channels:4}}).png().toBuffer();
    const file=`Frames/Detonate_${String(i).padStart(3,'0')}.png`;
    await fs.writeFile(path.join(folder,file),bytes);files.push(path.join(folder,file));
    const x=(i%COLUMNS)*SIZE,y=Math.floor(i/COLUMNS)*SIZE;
    for(let row=0;row<SIZE;row++) pixels.copy(sheet,((y+row)*sheetWidth+x)*4,row*SIZE*4,(row+1)*SIZE*4);
    const durationMs=Math.round((i+1)*1000/FPS)-Math.round(i*1000/FPS);delays.push(durationMs);
    frames.push({index:i,file,sheet:'Detonate-Sheet_00.png',x,y,width:SIZE,height:SIZE,durationMs,keyframe:key,blend:mix,sha256:hash(bytes)});
    if(i===5) await fs.writeFile(path.join(folder,'Icon.png'),bytes);
  }
  await sharp(sheet,{raw:{width:sheetWidth,height:sheetHeight,channels:4}}).png().toFile(path.join(folder,'Detonate-Sheet_00.png'));
  await sharp(files,{join:{animated:true}}).webp({lossless:true,effort:3,loop:0,delay:delays.map((d,i)=>d+(i===COUNT-1?850:0))}).toFile(path.join(folder,'Detonate-Preview.webp'));
  await sharp(files,{join:{animated:true}}).webp({lossless:true,effort:3,loop:1,delay:delays}).toFile(path.join(folder,'Detonate-OneShot.webp'));
  const metadata={schemaVersion:1,status:'animation-proposal; not connected to match renderer',key:'FPVDroneExplosion',label:'FPV drone explosion',age:'Modern',type:'effect',camera:'vertical-overhead-orthographic',directionCount:1,frameSize:{width:SIZE,height:SIZE},pivot:{x:SIZE/2,y:SIZE/2},normalizedPivot:{x:.5,y:.5},alpha:'straight',textureLimit:4096,frameOrder:'row-major',animations:{detonate:{frameCount:COUNT,sourceKeyframeCount:16,suggestedFramesPerSecond:FPS,loop:false,durationMs:1500,preview:'Detonate-Preview.webp',once:'Detonate-OneShot.webp',previewPauseMs:850,files:['Detonate-Sheet_00.png'],sheets:[{file:'Detonate-Sheet_00.png',width:sheetWidth,height:sheetHeight,columns:COLUMNS,rows:Math.ceil(COUNT/COLUMNS),firstFrame:0,frameCount:COUNT}],frames}},sourceAudit:{file:'SourceArt/Detonate.png',sha256:hash(await fs.readFile(source)),grid,cells:audit},notes:['Compact overhead flash, fireball, fragments and smoke; no persistent crater.','Generated painted keys are registered with the existing Modern Defense helper, then blended in premultiplied alpha.','Thirty-six exported frames are not thirty-six independently painted frames.','Visual size and timing are art proposals without damage or gameplay authority.']};
  await fs.writeFile(path.join(folder,'animations.json'),JSON.stringify(metadata,null,2)+'\n');
  const previewInfo=await sharp(path.join(folder,'Detonate-Preview.webp'),{animated:true}).metadata();
  if(previewInfo.pages!==COUNT) throw new Error('Animated preview frame count mismatch');
  await fs.writeFile(path.join(folder,'Validation.json'),JSON.stringify({status:'passed',frameCount:COUNT,sourceKeyframeCount:16,frameSize:SIZE,sheetSize:[sheetWidth,sheetHeight],transparentBorders:true,fullyTransparentTerminalFrame:true,ignitionNonempty:true,peakAlpha,animatedPreviewFrames:previewInfo.pages,sourcePreserved:true},null,2)+'\n');
  console.log(`Exported ${COUNT} FPV explosion frames, PNG sheet and two animated WebP files; alpha, clipping, terminal fade and WebP frame count passed.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
