const folders = {carrier:'Ships/Modern/Carrier',drone:'Aircraft/Modern/FPVDrone'};
const sheets = {};
const controls = Object.fromEntries(['play','previous','next','frame','frame-label','speed','background','carrier-clip','drone-clip','status'].map(id=>[id,document.getElementById(id)]));
const load = async file => {
  const image = new Image(); image.src=file; await image.decode(); return image;
};
try {
  for (const [kind,folder] of Object.entries(folders)) {
    const response = await fetch(`${folder}/animations.json`);
    if(!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
    const metadata=await response.json();
    for(const [clip,animation] of Object.entries(metadata.animations)) {
      const image=await load(`${folder}/${animation.file}`);
      if(image.naturalWidth!==2560 || image.naturalHeight!==2048) throw new Error('Unexpected sheet dimensions');
      sheets[`${kind}:${clip}`]=image;
    }
  }
  controls.status.textContent='All 5 animation sheets loaded · 100 frames · use Pause and frame stepping to inspect.';
  let playing=!matchMedia('(prefers-reduced-motion: reduce)').matches, frame=0, last=0, accumulator=0;
  const updatePlay = () => controls.play.textContent=playing?'Pause':'Play';
  updatePlay();
  function draw() {
    controls.frame.value=frame; controls['frame-label'].textContent=`${frame+1} / 20`;
    for(const canvas of document.querySelectorAll('canvas[data-kind]')) {
      const kind=canvas.dataset.kind,clip=controls[`${kind}-clip`].value;
      const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(sheets[`${kind}:${clip.toLowerCase()}`],(frame%5)*512,Math.floor(frame/5)*512,512,512,0,0,canvas.width,canvas.height);
      document.getElementById(`${kind}-sheet`).href=`${folders[kind]}/${clip}.png`;
    }
  }
  controls.play.onclick=()=>{playing=!playing;accumulator=0;updatePlay();};
  const step = delta => {playing=false;frame=(frame+delta+20)%20;updatePlay();draw();};
  controls.previous.onclick=()=>step(-1);controls.next.onclick=()=>step(1);
  controls.frame.oninput=()=>{playing=false;frame=Number(controls.frame.value);updatePlay();draw();};
  controls['carrier-clip'].onchange=draw; controls['drone-clip'].onchange=draw;
  controls.background.onchange=()=>document.body.dataset.background=controls.background.value;
  function tick(now) {
    if(last && playing) {
      accumulator+=Math.min(now-last,200)*Number(controls.speed.value);
      const steps=Math.floor(accumulator/50);
      if(steps){frame=(frame+steps)%20;accumulator-=steps*50;draw();}
    }
    last=now;requestAnimationFrame(tick);
  }
  draw();requestAnimationFrame(tick);
} catch(error) {controls.status.textContent=`Failed to load artwork: ${error.message}`;console.error(error);}
