// Art review only. These display rules mirror the cited production
// sources in the Russian Generation-Manifest; no simulation or match assets change.
export class FleetScaleReview {
  constructor(section, canvas, zoom, compare, motion) {
    this.section = section;
    this.canvas = canvas;
    this.zoom = zoom;
    this.compare = compare;
    this.motion = motion;
    this.assets = [];
    this.base = new Map();
    this.atlases = new WeakMap();
    zoom.addEventListener('change', () => this.draw());
    compare.addEventListener('change', () => this.draw());
    motion.addEventListener('change', () => this.draw());
  }

  setAssets(assets, age = 'StoneAge', culture = 'Russian') {
    this.assets = assets;
    this.age = age; this.culture = culture;
    this.section.hidden = assets.length === 0;
    this.motion.disabled = !assets.some(asset => asset.data);
    const originals = {
      Warships: 'warship', Transport: 'transport', Trade: 'trade',
    };
    for (const asset of assets) {
      const category = asset.unit.directory;
      const key = `${age}:${category}`;
      if (!this.base.has(key)) {
        const image = new Image();
        this.base.set(key, image);
        image.onload = () => this.draw();
        image.src = `../Runtime/Ages/${age.toLowerCase()}-${originals[category]}-portrait.png`;
      }
    }
    this.draw();
  }

  spriteSize(category, scale) {
    // MapSymbols.shipSpriteSize / traderSymbol; EraArtwork frame extent = 4/3.
    const size = category === 'Trade'
      ? Math.min(77, scale * 2)
      : Math.min(category === 'Warships' ? 125 : 87.5, scale * 2.4);
    return size * 4 / 3;
  }

  atlas(image, frame, runtimeFrame) {
    let frames = this.atlases.get(image);
    if (!frames) { frames = new Map(); this.atlases.set(image, frames); }
    const key = frame ? frame.index : runtimeFrame ? 'runtime' : 'master';
    if (frames.has(key)) return frames.get(key);
    const atlas = document.createElement('canvas'); atlas.width = atlas.height = 128;
    const context = atlas.getContext('2d');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    if (frame) context.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, 128, 128);
    else if (runtimeFrame) context.drawImage(image, 0, 0, 128, 128);
    else context.drawImage(image, 46 / 4, 46 / 4, 420 / 4, 420 / 4);
    frames.set(key, atlas);
    return atlas;
  }

  drawMaster(ctx, image, x, y, size, category, runtimeFrame = false, frame = null) {
    if (!image?.complete || !image.naturalWidth) return;
    // The ship authoring pipeline fits the 1254px source into a 420px square
    // within a 512px frame. Preview that same framing at the runtime atlas size.
    const atlas = this.atlas(image, frame, runtimeFrame);
    ctx.save(); ctx.translate(x, y);
    ctx.globalAlpha = category === 'Trade' ? 0.85 : 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(atlas, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  draw() {
    if (!this.assets.length) return;
    const width = Math.max(320, this.canvas.clientWidth);
    const height = this.compare.checked ? 390 : 210;
    const ratio = window.devicePixelRatio || 1;
    const pixelsWide = Math.round(width * ratio), pixelsHigh = Math.round(height * ratio);
    if (this.canvas.width !== pixelsWide || this.canvas.height !== pixelsHigh) {
      this.canvas.width = pixelsWide; this.canvas.height = pixelsHigh;
      this.canvas.style.height = `${height}px`;
    }
    const ctx = this.canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // PaintedTerrain.PALETTES.ocean. Flat water isolates readability from effects.
    ctx.fillStyle = '#305b74'; ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center'; ctx.font = '600 13px system-ui'; ctx.fillStyle = '#edf0eb';
    const scale = Number(this.zoom.value);
    const categories = [...new Set(this.assets.map(asset => asset.unit.directory))];
    const column = width / categories.length;
    for (const [index, category] of categories.entries()) {
      const candidates = this.assets.filter(asset => asset.unit.directory === category);
      const asset = candidates.find(asset => asset.state === this.motion.value)
        || candidates.find(asset => asset.state === 'idle') || candidates[0];
      const x = (index + 0.5) * column;
      const size = this.spriteSize(category, scale);
      ctx.fillText(asset.unit.label, x, 25);
      const frame = asset.data?.frames[asset.currentFrame ?? 0];
      this.drawMaster(ctx, asset.image, x, 105, size, category, false, frame);
      ctx.font = '12px system-ui'; ctx.fillStyle = '#d7e2e7';
      ctx.fillText(`${this.culture} · ${asset.still ? 'master' : asset.state} · ${Math.round(size)} px frame`, x, 190);
      if (this.compare.checked) {
        this.drawMaster(ctx, this.base.get(`${this.age}:${category}`), x, 285, size, category, true);
        ctx.fillText('Base · still', x, 376);
      }
      ctx.font = '600 13px system-ui'; ctx.fillStyle = '#edf0eb';
    }
  }
}
