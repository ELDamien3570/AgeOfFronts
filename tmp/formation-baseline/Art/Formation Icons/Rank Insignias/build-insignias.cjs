// Native, independently colored troop-rank overlays. No game code is changed.
// Usage: node build-insignias.cjs [absolute path to the sharp package]
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');

const root = __dirname;
const formationRoot = path.dirname(root);
const palette = { green: '#2bd05b', gold: '#ffd044', purple: '#914de8', black: '#000000' };
const levels = [
  ...Array.from({ length: 5 }, (_, index) => ({ level: index + 1, stars: index + 1, layout: 'row', fill: palette.green, outline: palette.black })),
  { level: 6, stars: 5, layout: 'ring', fill: palette.gold, outline: palette.black },
  { level: 7, stars: 5, layout: 'ring', fill: palette.purple, outline: palette.gold },
];

function star(cx, cy, radius, fill, outline) {
  const points = Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const r = index % 2 === 0 ? radius : radius * .49;
    return `${(cx + Math.cos(angle) * r).toFixed(3)},${(cy + Math.sin(angle) * r).toFixed(3)}`;
  }).join(' ');
  return `<polygon points="${points}" fill="${fill}" stroke="${outline}" stroke-width="8" stroke-linejoin="round"/>`;
}

function artwork(rank) {
  const row = rank.layout === 'row';
  const width = row ? 512 : 256;
  const height = row ? 128 : 256;
  let content = '';
  for (let index = 0; index < rank.stars; index++) {
    if (row) {
      content += star(256 + (index - (rank.stars - 1) / 2) * 100, 64, 43, rank.fill, rank.outline);
    } else {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
      content += star(128 + Math.cos(angle) * 80, 128 + Math.sin(angle) * 80, 36, rank.fill, rank.outline);
    }
  }
  return { width, height, source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision"><title>Troop level ${rank.level} insignia</title>${content}</svg>\n` };
}

function imageTag(buffer, x, y, width, height) {
  return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="data:image/png;base64,${buffer.toString('base64')}"/>`;
}

async function thumb(file, width, trim = false) {
  let input = sharp(file);
  if (trim) input = input.trim({ background: '#00000000' });
  const buffer = await input.resize({ width, kernel: 'lanczos3' }).png().toBuffer();
  const info = await sharp(buffer).metadata();
  return { buffer, width: info.width, height: info.height };
}

async function saveReview(name, width, height, content) {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
  await fs.writeFile(path.join(root, `${name}.svg`), source, 'utf8');
  await sharp(Buffer.from(source)).png().toFile(path.join(root, `${name}.png`));
}

async function main() {
  await fs.mkdir(path.join(root, 'svg'), { recursive: true });
  await fs.mkdir(path.join(root, 'png'), { recursive: true });
  const assets = [];
  for (const rank of levels) {
    const id = `level-${String(rank.level).padStart(2, '0')}`;
    const art = artwork(rank);
    const pngPath = path.join(root, 'png', `${id}.png`);
    await fs.writeFile(path.join(root, 'svg', `${id}.svg`), art.source, 'utf8');
    await sharp(Buffer.from(art.source)).png().toFile(pngPath);
    const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const fillRgb = rank.fill.match(/\w\w/g).map(part => parseInt(part, 16));
    const outlineRgb = rank.outline.match(/\w\w/g).map(part => parseInt(part, 16));
    let fillPixels = 0, outlinePixels = 0, transparentPixels = 0, opaquePixels = 0, edgePixels = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const pixel = i / info.channels;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      if (!data[i + 3]) { transparentPixels++; continue; }
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) edgePixels++;
      if (data[i + 3] !== 255) continue;
      opaquePixels++;
      if (fillRgb.every((channel, c) => data[i + c] === channel)) fillPixels++;
      if (outlineRgb.every((channel, c) => data[i + c] === channel)) outlinePixels++;
    }
    if (!fillPixels || !outlinePixels || !transparentPixels || edgePixels) throw new Error(`Bad color, alpha or clipping in ${id}`);
    assets.push({ ...rank, id, width: info.width, height: info.height, svg: `svg/${id}.svg`, png: `png/${id}.png`, anchor: { x: .5, y: 0 }, validation: { fillPixels, outlinePixels, transparentPixels, opaquePixels, edgePixels } });
  }

  const meleePath = path.join(formationRoot, 'png', 'melee.png');
  const largeFormation = await thumb(meleePath, 142, true);
  let overview = '<rect width="1280" height="350" fill="#202a2d"/><text x="20" y="34" font-family="Arial,sans-serif" font-size="24" fill="#ffffff">TROOP LEVEL INSIGNIAS</text><text x="20" y="61" font-family="Arial,sans-serif" font-size="15" fill="#c9d4d6">Transparent rank overlays shown beneath the existing formation marker</text>';
  for (const [column, rank] of levels.entries()) {
    const x = 15 + column * 180;
    const cx = x + 85;
    const id = `level-${String(rank.level).padStart(2, '0')}`;
    const badge = await thumb(path.join(root, 'png', `${id}.png`), rank.layout === 'row' ? 154 : 72);
    overview += `<rect x="${x}" y="83" width="170" height="250" rx="8" fill="#354348"/>`;
    overview += imageTag(largeFormation.buffer, cx - largeFormation.width / 2, 104, largeFormation.width, largeFormation.height);
    overview += imageTag(badge.buffer, cx - badge.width / 2, 194, badge.width, badge.height);
    overview += `<text x="${cx}" y="303" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="#ffffff">Level ${rank.level}${rank.level === 7 ? ' / MAX' : ''}</text>`;
  }
  await saveReview('overview', 1280, 350, overview);

  const rows = [
    { unit: 'melee', width: 24, label: 'Melee / 24 px' },
    { unit: 'melee', width: 32, label: 'Melee / 32 px' },
    { unit: 'warship', width: 32, label: 'Warship / 32 px' },
    { unit: 'transport-ship', width: 32, label: 'Transport / 32 px' },
  ];
  let review = '<rect width="860" height="634" fill="#202a2d"/><text x="20" y="33" font-family="Arial,sans-serif" font-size="23" fill="#ffffff">SMALL SIZE / BOTTOM PLACEMENT</text><text x="20" y="61" font-family="Arial,sans-serif" font-size="15" fill="#c9d4d6">Marker widths shown at actual size. Ring insignias are 16 px across.</text>';
  levels.forEach((rank, column) => { review += `<text x="${258 + column * 84}" y="91" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" fill="#ffffff">Level ${rank.level}</text>`; });
  for (const [row, spec] of rows.entries()) {
    const y = 106 + row * 126;
    const formation = await thumb(path.join(formationRoot, 'png', `${spec.unit}.png`), spec.width, true);
    review += `<rect x="16" y="${y}" width="828" height="116" rx="7" fill="#354348"/><text x="30" y="${y + 64}" font-family="Arial,sans-serif" font-size="17" fill="#ffffff">${spec.label}</text>`;
    for (const [column, rank] of levels.entries()) {
      const cx = 258 + column * 84;
      const id = `level-${String(rank.level).padStart(2, '0')}`;
      const badge = await thumb(path.join(root, 'png', `${id}.png`), rank.layout === 'row' ? spec.width : 16);
      const totalHeight = formation.height + 2 + badge.height;
      const top = Math.round(y + (116 - totalHeight) / 2);
      review += imageTag(formation.buffer, cx - formation.width / 2, top, formation.width, formation.height);
      review += imageTag(badge.buffer, cx - badge.width / 2, top + formation.height + 2, badge.width, badge.height);
    }
  }
  await saveReview('small-size-review', 860, 634, review);
  await fs.writeFile(path.join(root, 'asset-manifest.json'), JSON.stringify({ maxTroopLevel: 7, palette, alpha: 'straight / unpremultiplied PNG', placement: 'centered below the formation marker, drawn without faction tint', display: { rowWidth: 'match the formation marker width', rowHeight: 'one quarter of row width', ringRecommendedSizePx: 16, gapPx: 2 }, assets }, null, 2) + '\n');
  console.log(JSON.stringify({ levels: assets.length, validation: 'fill, outline, transparency and unclipped margins passed', output: root }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
