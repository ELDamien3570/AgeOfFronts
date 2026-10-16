// Run: node build-modern-naval-air.cjs <path-to-@napi-rs/canvas> [carrier|drone]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

async function main() {
  const { createCanvas, loadImage } = require(process.argv[2] || '@napi-rs/canvas');
  const { FRAME_COUNT, FPS, CLIPS, renderClip } = await import(pathToFileURL(path.join(__dirname, 'modern-naval-air-renderer.mjs')));
  const sources = {
    carrier: 'Ships/Modern/Carrier/SourceArt/Carrier_Russian_Modern_v2.png',
    drone: 'Aircraft/Modern/FPVDrone/SourceArt/FPVDrone_Russian_Modern_v1.png',
    droneBody: 'Aircraft/Modern/FPVDrone/SourceArt/FPVDrone_Body_v1.png',
  };
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const images = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([key, file]) => [key, await loadImage(path.join(__dirname, file))])));
  const report = { status: 'passed', kind: 'export validation; browser visual review is separate', assets: [], sources: {} };
  const selectedKind = process.argv[3];
  if (selectedKind && !Object.hasOwn(CLIPS, selectedKind)) throw new Error('Expected carrier or drone');
  const reportFile = path.join(__dirname,'Modern-Naval-Air-Validation.json');
  if (selectedKind && fs.existsSync(reportFile)) {
    report.assets = JSON.parse(fs.readFileSync(reportFile,'utf8')).assets.filter(asset => asset.kind !== selectedKind);
  }
  let exported = 0;
  for (const [key, file] of Object.entries(sources)) report.sources[file] = hash(path.join(__dirname, file));
  for (const [kind, clips] of Object.entries(CLIPS)) {
    if (selectedKind && kind !== selectedKind) continue;
    const folder = kind === 'carrier' ? 'Ships/Modern/Carrier' : 'Aircraft/Modern/FPVDrone';
    const destination = path.join(__dirname, folder);
    const metadata = {
      schemaVersion: 1, cultureId: 'russian', age: 'Modern',
      unit: kind === 'carrier' ? 'Modern aircraft carrier' : 'FPV quadcopter drone',
      status: 'art draft; not registered in match renderer',
      camera: 'vertical-overhead-orthographic', facing: 'screen-up',
      frameSize: {width:512,height:512}, sheetSize:{width:2560,height:2048},
      grid:{columns:5,rows:4}, pivot:{x:256,y:256}, normalizedPivot:{x:.5,y:.5},
      animationMethod: 'Rigid painted master with deterministic visual effects; drone uses generated body layer and procedural propeller motion',
      animations: {},
    };
    for (const clip of clips) {
      const sheet = createCanvas(2560,2048), sheetCtx = sheet.getContext('2d');
      const frames = [];
      let previous, different = false;
      for (let i = 0; i < FRAME_COUNT; i++) {
        const frame = createCanvas(512,512), ctx = frame.getContext('2d');
        renderClip(ctx,images,kind,clip,i);
        const data = ctx.getImageData(0,0,512,512).data;
        let visible = 0;
        for (let p=3; p<data.length; p+=4) if(data[p]) visible++;
        if (!visible) throw new Error(`${kind} ${clip} ${i}: empty frame`);
        for (let p=0; p<512; p++) {
          if (data[p*4+3] || data[((511*512+p)*4)+3] || data[(p*512)*4+3] || data[((p*512+511)*4)+3]) throw new Error(`${kind} ${clip} ${i}: clipped border`);
        }
        const digest=crypto.createHash('sha256').update(data).digest('hex');
        if(previous && previous!==digest) different=true;
        previous=digest;
        const x=(i%5)*512,y=Math.floor(i/5)*512;
        sheetCtx.drawImage(frame,x,y);
        frames.push({index:i,x,y,width:512,height:512});
        if(i===0) fs.writeFileSync(path.join(destination,`${clip}-FirstFrame.png`),frame.toBuffer('image/png'));
      }
      if (clip !== 'Idle' && !different) throw new Error(`${kind} ${clip}: no animation`);
      const file = `${clip}.png`;
      fs.writeFileSync(path.join(destination,file),sheet.toBuffer('image/png'));
      metadata.animations[clip.toLowerCase()]={file,frameCount:FRAME_COUNT,suggestedFramesPerSecond:FPS,loop:true,frames,sha256:hash(path.join(destination,file))};
      report.assets.push({kind,clip,frameCount:FRAME_COUNT,transparentBorder:true,nonempty:true,hasMotion:different});
      exported++;
    }
    fs.copyFileSync(path.join(destination,'Idle-FirstFrame.png'),path.join(destination,'Icon.png'));
    fs.writeFileSync(path.join(destination,'animations.json'),JSON.stringify(metadata,null,2)+'\n');
  }
  fs.writeFileSync(path.join(__dirname,'Modern-Naval-Air-Validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`Exported ${exported} clips, ${exported*FRAME_COUNT} frames. Transparency, nonempty frames, clipping and motion checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode=1; });
