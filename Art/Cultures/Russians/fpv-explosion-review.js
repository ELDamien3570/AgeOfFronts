const root='Aircraft/Modern/FPVDrone/Explosion/';
const button=document.getElementById('explosion-play');
const replay=document.getElementById('explosion-replay');
const slider=document.getElementById('explosion-frame');
const label=document.getElementById('explosion-frame-label');
const repeat=document.getElementById('explosion-repeat');
const status=document.getElementById('explosion-status');
try {
  const response=await fetch(root+'animations.json');
  if(!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
  const metadata=await response.json(), clip=metadata.animations.detonate;
  const sheet=new Image();sheet.src=root+clip.files[0];await sheet.decode();
  if(sheet.naturalWidth!==clip.sheets[0].width || sheet.naturalHeight!==clip.sheets[0].height) throw new Error('Unexpected sheet dimensions');
  let frame=5,playing=false,elapsed=5*1000/clip.suggestedFramesPerSecond,last=0;
  const duration=clip.durationMs, period=1000/clip.suggestedFramesPerSecond;
  function draw() {
    const rect=clip.frames[frame];
    for(const canvas of document.querySelectorAll('canvas[data-fpv-explosion]')) {
      const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(sheet,rect.x,rect.y,rect.width,rect.height,0,0,canvas.width,canvas.height);
    }
    slider.value=frame;label.textContent=`${frame+1} / ${clip.frameCount}`;
    button.textContent=playing?'Pause':'Play';
  }
  replay.onclick=()=>{elapsed=0;frame=0;playing=true;draw();};
  button.onclick=()=>{
    if(!playing && frame===clip.frameCount-1){elapsed=0;frame=0;}
    playing=!playing;draw();
  };
  slider.oninput=()=>{playing=false;frame=Number(slider.value);elapsed=frame*period;draw();};
  status.textContent='Explosion loaded · 36 frames · final frame fully transparent. Replay or scrub to inspect.';
  function tick(now) {
    if(last && playing) {
      elapsed+=Math.min(now-last,200);
      if(elapsed>=duration && !repeat.checked) {elapsed=duration;playing=false;}
      if(repeat.checked && elapsed>=duration+clip.previewPauseMs) elapsed%=duration+clip.previewPauseMs;
      const next=Math.min(clip.frameCount-1,Math.floor(elapsed/period));
      if(next!==frame || !playing){frame=next;draw();}
    }
    last=now;requestAnimationFrame(tick);
  }
  draw();requestAnimationFrame(tick);
} catch(error) {status.textContent=`Explosion failed to load: ${error.message}`;console.error(error);}
