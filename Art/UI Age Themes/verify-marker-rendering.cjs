const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { createCanvas, Image } = require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');

async function main() {
  // Use the source-generated marker module with lossless native canvas pixels.
  // Browser review screenshots are JPEG encoded and cannot prove pixel equality.
  global.Image = class extends Image {
    get naturalWidth() { return this.width; }
    get naturalHeight() { return this.height; }
    set src(value) { super.src = value.startsWith('file:') ? fileURLToPath(value) : value; }
  };
  global.document = { createElement(type) { if (type !== 'canvas') throw new Error(type); return createCanvas(1, 1); } };
  const { BuildingMarkers, BUILDING_MARKER_FRAMES } = await import(pathToFileURL(path.join(__dirname, 'shared-building-markers.js')));
  const themes = JSON.parse(await fs.readFile(path.join(__dirname, 'themes.json'), 'utf8')).themes;
  const markers = new BuildingMarkers();
  if (!await markers.ready) throw new Error('Marker atlas unavailable');
  const crop = (frame, margin) => Buffer.from(frame.source.getContext('2d').getImageData(frame.x + margin, frame.y + margin, frame.width - margin * 2, frame.height - margin * 2).data);
  const rim = frame => Buffer.from(frame.source.getContext('2d').getImageData(frame.x, frame.y + Math.floor(frame.height / 2), 1, 1).data);
  const failures = [];
  let centerComparisons = 0, rimComparisons = 0;
  for (const ratio of [1, 2]) for (const type of Object.keys(BUILDING_MARKER_FRAMES)) {
    const original = markers.get(type, '#7dccb4', 18, ratio);
    const margin = Math.ceil(original.width / 12 + original.width / 72) + 1;
    const center = crop(original, margin);
    for (const theme of themes) {
      const framed = markers.get(type, '#7dccb4', 18, ratio, theme.age);
      if (!crop(framed, margin).equals(center)) failures.push(`${type}/${theme.age}/${ratio}: center changed`);
      centerComparisons++;
      const red = markers.get(type, '#da8981', 18, ratio, theme.age);
      if (!rim(framed).equals(rim(red))) failures.push(`${type}/${theme.age}/${ratio}: faction tinted material`);
      rimComparisons++;
    }
  }
  const report = { status: failures.length ? 'FAIL' : 'PASS', symbols: 21, ages: 7, pixelRatios: [1, 2], centerComparisons, factionIndependentRimComparisons: rimComparisons, failures, browserScreenshotNote: 'JPEG compression makes exact screenshot center comparisons inconclusive; this check uses native canvas pixels.' };
  await fs.writeFile(path.join(__dirname, 'Marker_Render_Verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
