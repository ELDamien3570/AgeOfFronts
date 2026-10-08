// Review-only playback. Airframes, movement and combat remain game-owned.
export class AircraftAnimationReview {
  constructor(toolbar) {
    this.views = []; this.cache = new Map(); this.epoch = 0;
    this.seconds = 0; this.playing = true; this.motion = 'flight'; this.speed = 1;
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;align-items:center';
    const button = (text, action) => {
      const node = document.createElement('button'); node.textContent = text;
      node.type = 'button'; node.addEventListener('click', action); controls.append(node); return node;
    };
    this.play = button('Pause', () => { this.playing = !this.playing; this.play.textContent = this.playing ? 'Pause' : 'Play'; });
    button('Previous frame', () => this.step(-1)); button('Next frame', () => this.step(1));
    const label = document.createElement('label'); label.textContent = 'Motion ';
    const select = document.createElement('select');
    for (const [value, text] of [['flight', 'Flight'], ['parked', 'Parked']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
    }
    select.addEventListener('change', () => { this.motion = select.value; this.seconds = 0; });
    label.append(select); controls.append(label);
    const speedLabel = document.createElement('label'); speedLabel.textContent = 'Speed ';
    const speed = document.createElement('select');
    for (const [value, text] of [[0.5, 'Half'], [1, 'Normal'], [2, 'Double']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = value === 1; speed.append(option);
    }
    speed.addEventListener('change', () => { this.speed = Number(speed.value); }); speedLabel.append(speed); controls.append(speedLabel);
    this.counter = document.createElement('output'); controls.append(this.counter); toolbar.after(controls);
    this.controls = controls; controls.hidden = true;
    let previous = performance.now();
    const tick = now => {
      const delta = Math.min((now-previous)/1000, 0.1); previous = now;
      if (this.playing) this.seconds += delta*this.speed;
      for (const view of this.views) this.draw(view);
      this.counter.textContent = `Frame ${Math.floor(this.seconds*20)%20+1} / 20`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  clear() { this.epoch++; this.views = []; this.seconds = 0; this.controls.hidden = true; }
  step(delta) { this.playing = false; this.play.textContent = 'Play'; this.seconds = ((Math.floor(this.seconds*20)+delta+20)%20)/20; }
  async load(url) {
    const key = url.href;
    if (!this.cache.has(key)) this.cache.set(key, (async () => {
      const response = await fetch(url, {cache: 'no-store'});
      if (!response.ok) throw new Error(`Animation metadata unavailable (${response.status})`);
      const data = await response.json(), images = {};
      for (const state of ['parked', 'flight']) {
        const clip = data.animations[state];
        if (clip.frameCount !== 20 || data.frameSize.width !== 512 || data.frameSize.height !== 512) throw new Error('Invalid aircraft animation contract');
        const image = new Image(), sheetUrl = new URL(clip.file, url);
        sheetUrl.searchParams.set('review', Date.now()); image.src = sheetUrl.href; await image.decode();
        if (image.naturalWidth !== data.sheetSize.width || image.naturalHeight !== data.sheetSize.height) throw new Error('Invalid aircraft sheet dimensions');
        images[state] = image;
      }
      return {data, images};
    })().catch(error => { this.cache.delete(key); throw error; }));
    return this.cache.get(key);
  }
  canvas(asset, manifestUrl, size = 320, fixedMotion = null, ground = true) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    canvas.style.cssText = `display:block;width:${size}px;max-width:100%;height:auto;margin:auto`;
    canvas.setAttribute('aria-label', `${asset.label} ${fixedMotion || 'animated'} at ${size} pixels`);
    const epoch = this.epoch;
    this.load(new URL(asset.metadata, manifestUrl)).then(resource => {
      if (epoch !== this.epoch) return;
      this.views.push({canvas, ...resource, fixedMotion, ground}); this.controls.hidden = false;
    }).catch(error => { if (epoch === this.epoch) { canvas.replaceWith(document.createTextNode(error.message)); } });
    return canvas;
  }
  card(asset, manifestUrl) {
    const card = document.createElement('article'), title = document.createElement('h2'), note = document.createElement('p'), link = document.createElement('a');
    title.textContent = asset.label;
    note.textContent = `${asset.role} · ${asset.age} · animated draft`;
    link.href = new URL(asset.metadata, manifestUrl).href; link.textContent = 'Animation metadata'; link.target = '_blank'; link.rel = 'noopener';
    card.append(title, this.canvas(asset, manifestUrl), note, link); return card;
  }
  draw(view) {
    const {canvas, data, images, fixedMotion, ground} = view, context = canvas.getContext('2d');
    const state = fixedMotion || this.motion, clip = data.animations[state];
    const frame = clip.frames[Math.floor(this.seconds*clip.suggestedFramesPerSecond)%clip.frameCount];
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (ground) {
      context.fillStyle = '#293b32'; context.fillRect(0, 0, canvas.width, canvas.height);
      const offset = state === 'flight' ? this.seconds*75 : 0;
      const tile = 80, start = Math.floor(offset/tile);
      for (let row = start-1; row < start+6; row++) {
        const y = row*tile-offset;
        context.fillStyle = '#344b3c'; context.fillRect(0, y, canvas.width*0.34, 50);
        context.fillStyle = '#3c4735'; context.fillRect(canvas.width*0.7, y+25, canvas.width*0.3, 42);
      }
      context.strokeStyle = '#758875'; context.lineWidth = 3;
      context.beginPath(); context.moveTo(canvas.width*0.15, 0); context.lineTo(canvas.width*0.8, canvas.height); context.stroke();
    }
    context.drawImage(images[state], frame.x, frame.y, frame.width, frame.height, 0, 0, canvas.width, canvas.height);
  }
}
