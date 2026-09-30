// Rebuild the native formation artwork and PNGs without modifying game code.
// Usage: node build-icons.cjs [absolute path to sharp] [optional previous PNG folder]
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');

const root = __dirname;
const white = '#ffffff';
const black = '#000000';

const sword = '<path d="M0-92L18-65V31H42V49H14V81H22V97H-22V81H-14V49H-42V31H-18V-65Z"/>';
const horse = `<path d="M108 354C124 321 147 285 162 253L128 264Q145 230 176 215L148 217Q175 188 216 177H250L270 152L279 183L303 159L299 206L350 262Q364 277 361 293Q358 310 342 312L329 311L302 287Q287 278 278 263Q272 297 291 328L316 354Z"/><ellipse cx="308" cy="238" rx="8" ry="6" transform="rotate(30 308 238)" fill="${white}"/>`;
const bow = `<g fill="none" stroke="${black}" stroke-linecap="round" stroke-linejoin="round">
  <path d="M223 164Q426 256 223 348" stroke-width="24"/>
  <path d="M223 164V348" stroke-width="12"/>
  <path d="M129 256H390" stroke-width="20"/>
  </g><path d="M416 256L369 224V288Z"/><path d="M156 256L126 230H104L134 256L104 282H126Z"/>`;

const symbols = {
  melee: `<g transform="translate(256 248) scale(1.28)"><g transform="rotate(-45)">${sword}</g><g transform="rotate(45)" stroke="${white}" stroke-width="7" paint-order="stroke fill">${sword}</g></g>`,
  ranged: bow,
  cavalry: horse,
  'ranged-cavalry': `<g transform="translate(-35 12) scale(.83 .94)">${horse}</g><g transform="translate(231 10) scale(.52 .96)">${bow}</g>`,
  'siege-catapult': `<g fill="none" stroke="${black}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round">
    <path d="M171 328L234 238L334 328ZM234 238V328M155 338H357"/>
    </g><path d="M184 317L359 161" fill="none" stroke="${black}" stroke-width="26" stroke-linecap="round"/>
    <circle cx="234" cy="272" r="25"/><circle cx="234" cy="272" r="8" fill="${white}"/>
    <circle cx="155" cy="350" r="40"/><circle cx="357" cy="350" r="40"/>
    <circle cx="155" cy="350" r="13" fill="${white}"/><circle cx="357" cy="350" r="13" fill="${white}"/>
    <g transform="rotate(-30 370 152)"><ellipse cx="370" cy="152" rx="42" ry="25"/><ellipse cx="370" cy="144" rx="31" ry="7" fill="${white}"/></g>`,
  warship: `<path d="M256 58L272 112H240Z"/>
    <g fill="none" stroke="${black}" stroke-width="18" stroke-linecap="square">
      <path d="M207 178L172 207M305 178L340 207M207 258L172 287M305 258L340 287M207 338L172 367M305 338L340 367"/>
    </g><path d="M256 86Q323 156 320 250L312 366Q302 415 256 444Q210 415 200 366L192 250Q189 156 256 86Z"/>
    <path d="M256 126Q280 176 280 246L276 367Q270 392 256 408Q242 392 236 367L232 246Q232 176 256 126Z" fill="${white}"/>
    <g stroke="${black}" stroke-width="18"><path d="M231 196H281M232 266H280M235 336H277"/></g>`,
  'transport-ship': `<path d="M256 78Q336 148 334 250L322 365Q313 420 256 450Q199 420 190 365L178 250Q176 148 256 78Z"/>
    <path d="M256 122Q304 166 304 242L295 361Q289 396 256 419Q223 396 217 361L208 242Q208 166 256 122Z" fill="${white}"/>
    <g fill="none" stroke="${black}" stroke-width="10" stroke-linejoin="miter">
      <path d="M226 188H286V248H226ZM226 283H286V343H226Z"/>
      <path d="M229 191L283 245M283 191L229 245M229 286L283 340M283 286L229 340"/>
    </g>`,
};

const labels = {
  melee: 'Melee', ranged: 'Ranged', cavalry: 'Cavalry',
  'ranged-cavalry': 'Ranged cavalry', 'siege-catapult': 'Siege / catapult',
  warship: 'Warship', 'transport-ship': 'Transport ship',
};

function geometry(id, tint = white) {
  if (id === 'warship' || id === 'transport-ship') {
    return `<g id="faction-field" fill="${tint}"><path d="M144 32H240L256 16L272 32H368V480H144Z"/></g>
      <path id="facing" d="M246 38L256 26L266 38Z" fill="${black}"/>
      <g id="unit-symbol" fill="${black}">${symbols[id]}</g>`;
  }
  if (id === 'siege-catapult') {
    return `<g id="faction-field" fill="${tint}"><circle cx="256" cy="256" r="208"/><path d="M237 51L256 32L275 51Z"/></g>
      <path id="facing" d="M241 59L256 41L271 59Z" fill="${black}"/>
      <g id="unit-symbol" fill="${black}">${symbols[id]}</g>`;
  }
  return `<g id="faction-field" fill="${tint}"><path d="M32 144H240L256 128L272 144H480V368H32Z"/></g>
    <path id="facing" d="M246 150L256 138L266 150Z" fill="${black}"/>
    <g id="unit-symbol" fill="${black}">${symbols[id]}</g>`;
}

function svg(id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" shape-rendering="geometricPrecision"><title>${labels[id]} formation marker</title>${geometry(id)}</svg>\n`;
}

async function main() {
  await fs.mkdir(path.join(root, 'svg'), { recursive: true });
  await fs.mkdir(path.join(root, 'png'), { recursive: true });
  const assets = [];
  for (const id of Object.keys(symbols)) {
    const source = svg(id);
    await fs.writeFile(path.join(root, 'svg', `${id}.svg`), source, 'utf8');
    const output = path.join(root, 'png', `${id}.png`);
    await sharp(Buffer.from(source)).png().toFile(output);
    const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let coloredPixels = 0;
    let opaquePixels = 0;
    let transparentPixels = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] === 0) transparentPixels++;
      else {
        if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) coloredPixels++;
        if (data[i + 3] === 255) opaquePixels++;
      }
    }
    if (coloredPixels || !opaquePixels || !transparentPixels) throw new Error(`Invalid grayscale/alpha in ${id}`);
    assets.push({ id, svg: `svg/${id}.svg`, png: `png/${id}.png`, width: info.width, height: info.height, coloredPixels, opaquePixels, transparentPixels });
  }
  const cells = Object.keys(symbols).map((id, i) => {
    const x = 14 + (i % 4) * 300;
    const y = 70 + Math.floor(i / 4) * 310;
    return `<rect x="${x}" y="${y}" width="282" height="294" rx="10" fill="#334044"/>
      <svg x="${x + 6}" y="${y + 4}" width="270" height="250" viewBox="0 0 512 512">${geometry(id)}</svg>
      <text x="${x + 141}" y="${y + 278}" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" fill="#f2f5f4">${labels[id]}</text>`;
  }).join('');
  const overview = `<svg xmlns="http://www.w3.org/2000/svg" width="1210" height="708" viewBox="0 0 1210 708"><rect width="1210" height="708" fill="#202a2d"/><text x="26" y="41" font-family="Arial,sans-serif" font-size="24" fill="#ffffff">FORMATION MARKERS / FACTION TINT BASES</text>${cells}<text x="930" y="484" font-family="Arial,sans-serif" font-size="19" fill="#ffffff">512 px transparent PNGs</text><text x="930" y="518" font-family="Arial,sans-serif" font-size="19" fill="#ffffff">Editable SVG masters</text><text x="930" y="552" font-family="Arial,sans-serif" font-size="17" fill="#bac7c8">Solid white field / black symbols</text><text x="930" y="586" font-family="Arial,sans-serif" font-size="17" fill="#bac7c8">Bolder artwork for small markers</text></svg>`;
  await fs.writeFile(path.join(root, 'overview.svg'), overview, 'utf8');
  await sharp(Buffer.from(overview)).png().toFile(path.join(root, 'overview.png'));
  const previousPngFolder = process.argv[3];
  const reviewColumns = previousPngFolder
    ? [{ label: 'Before 24 px', width: 24, old: true }, { label: 'Now 24 px', width: 24 }, { label: 'Before 32 px', width: 32, old: true }, { label: 'Now 32 px', width: 32 }, { label: 'Now 48 px', width: 48 }]
    : [{ label: '24 px wide', width: 24 }, { label: '32 px wide', width: 32 }, { label: '48 px wide', width: 48 }];
  let review = '<rect width="810" height="942" fill="#253236"/><text x="20" y="33" font-family="Arial,sans-serif" font-size="23" fill="#ffffff">SMALL SIZE REVIEW</text><text x="20" y="61" font-family="Arial,sans-serif" font-size="15" fill="#cbd5d7">Actual marker widths. PNG previews; visibility in the game depends on its renderer.</text>';
  reviewColumns.forEach((column, i) => {
    review += `<text x="${265 + i * 110}" y="94" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#ffffff">${column.label}</text>`;
  });
  for (const [row, id] of Object.keys(symbols).entries()) {
    const y = 116 + row * 116;
    review += `<rect x="16" y="${y}" width="778" height="108" rx="6" fill="#354448"/><text x="30" y="${y + 59}" font-family="Arial,sans-serif" font-size="18" fill="#ffffff">${labels[id]}</text>`;
    for (const [columnIndex, column] of reviewColumns.entries()) {
      const input = path.join(column.old ? previousPngFolder : path.join(root, 'png'), `${id}.png`);
      const thumb = await sharp(input).trim({ background: '#00000000' }).resize({ width: column.width, kernel: 'lanczos3' }).png().toBuffer();
      const info = await sharp(thumb).metadata();
      review += `<image x="${265 + columnIndex * 110 - info.width / 2}" y="${y + (108 - info.height) / 2}" width="${info.width}" height="${info.height}" href="data:image/png;base64,${thumb.toString('base64')}"/>`;
    }
  }
  const reviewSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="810" height="942" viewBox="0 0 810 942">${review}</svg>`;
  await fs.writeFile(path.join(root, 'small-size-review.svg'), reviewSvg, 'utf8');
  await sharp(Buffer.from(reviewSvg)).png().toFile(path.join(root, 'small-size-review.png'));
  await fs.writeFile(path.join(root, 'asset-manifest.json'), JSON.stringify({ revision: 3, canvas: { width: 512, height: 512, pivot: [256, 256], forward: 'up' }, palette: { symbol: black, factionField: white }, reviewMarkerWidthsPx: [24, 32, 48], alpha: 'straight / unpremultiplied PNG', assets }, null, 2) + '\n');
  console.log(JSON.stringify({ count: assets.length, alphaAndGrayscale: 'pass', output: root }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
