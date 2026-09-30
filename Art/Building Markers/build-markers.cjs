// One vector design per BuildingType; all resolutions share the same geometry.
// node build-markers.cjs [absolute path to sharp]
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
const root = __dirname;
const stroke = (d, width = 3.2) => `<path d="${d}" fill="none" stroke="#000" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const sword = '<path d="M-1.7-9L0-12L1.7-9V3H4V5.8H1.7V9H-1.7V5.8H-4V3H-1.7Z"/>';
const designs = [
  ['barracks','Barracks','Crossed swords',`<g transform="translate(16 16)"><g transform="rotate(-45)">${sword}</g><g transform="rotate(45)">${sword}</g></g>`],
  ['archery','Archery range','Bullseye','<circle cx="16" cy="16" r="10" fill="none" stroke="#000" stroke-width="3.2"/><circle cx="16" cy="16" r="4.8" fill="none" stroke="#000" stroke-width="3.2"/>'],
  ['stables','Stables','Horse head','<g transform="translate(-4.5 -6.5) scale(.088)"><path d="M108 354C124 321 147 285 162 253L128 264Q145 230 176 215L148 217Q175 188 216 177H250L270 152L279 183L303 159L299 206L350 262Q364 277 361 293Q358 310 342 312L329 311L302 287Q287 278 278 263Q272 297 291 328L316 354Z"/><ellipse cx="308" cy="238" rx="9" ry="8" fill="#fff"/></g>'],
  ['city','City','Town skyline','<path d="M4 16H10V27H4ZM11 13L16 7L21 13V27H11ZM22 16H28V27H22Z"/><path d="M14 21H18V27H14Z" fill="#fff"/>'],
  ['factory','Factory','Sawtooth roof and chimney','<path d="M4 15L12 10V15L20 10V15H23V5H28V27H4Z"/><path d="M7 20H12V23H7ZM16 20H21V23H16Z" fill="#fff"/>'],
  ['port','Port','Anchor',`<circle cx="16" cy="7" r="2.7" fill="none" stroke="#000" stroke-width="3"/>${stroke('M16 10V26M10 13H22M5 18Q5 25 16 27Q27 25 27 18M5 18V22M27 18V22')}`],
  ['mine','Mine','Pickaxe',`${stroke('M7 26L21 8',3.8)}<path d="M4 12Q15 1 28 10L26 13Q15 7 5 15Z"/>`],
  ['blacksmith','Blacksmith','Anvil','<path d="M3 11H27V15H23Q18 16 18 21H23V27H9V21H13Q13 17 9 17L3 13Z"/>'],
  ['armory','Armory','Shield and sword','<path d="M5 5H27V16Q27 24 16 28Q5 24 5 16Z"/><path d="M16 9L18 12V19H21V22H18V25H14V22H11V19H14V12Z" fill="#fff"/>'],
  ['arms-factory','Arms factory','Ammunition cartridges','<path d="M6 25V10L10 4L14 10V25ZM18 25V10L22 4L26 10V25Z"/><path d="M6 19H14V22H6ZM18 19H26V22H18Z" fill="#fff"/>'],
  ['siege-workshop','Siege workshop','Catapult',`${stroke('M8 24H25M10 23L16 13L22 23M13 20L25 7',3.2)}<circle cx="8" cy="26" r="3"/><circle cx="25" cy="26" r="3"/><path d="M22 5H29V8Q25.5 12 22 8Z"/>`],
  ['depot','Vehicle depot','Cargo truck','<path d="M3 10H19V23H3ZM20 14H25L29 19V24H20Z"/><path d="M22 16H24L27 19H22Z" fill="#fff"/><circle cx="8" cy="25" r="3.3"/><circle cx="24" cy="25" r="3.3"/><path d="M6 25H10M22 25H26" stroke="#fff" stroke-width="1.5"/>'],
  ['tower','Tower','Battlement tower','<path d="M6 5H11V9H14V5H18V9H21V5H26V13H23V27H9V13H6Z"/><path d="M14 21H18V27H14Z" fill="#fff"/>'],
  ['airstrip','Military airstrip','Aircraft silhouette','<path d="M14 4H18V12L28 18V21L18 18V24L23 27V29L16 27L9 29V27L14 24V18L4 21V18L14 12Z"/>'],
  ['oil-well','Oil well','Pumpjack',`<path d="M4 10L25 5L28 8L7 14Z"/><path d="M4 8H8V18H4Z"/>${stroke('M17 12L24 26H10Z',3)}${stroke('M5 27H27',3)}`],
  ['oil-rig','Oil rig','Offshore derrick',`${stroke('M16 4L24 21H8ZM12 13H20',3)}<path d="M5 20H27V24H5Z"/>${stroke('M4 28Q7 25 10 28Q13 25 16 28Q19 25 22 28Q25 25 28 28',2.8)}`],
  ['gun-nest','Gun nest','Mounted gun in a pit',`${stroke('M5 16V24Q16 30 27 24V16',3.5)}${stroke('M16 4V16',3.5)}<path d="M12 15H20V23H12ZM7 16H11V21H7Z"/>`],
  ['trench','Trench','Stepped trench',stroke('M4 7H12V16H21V25H28',5)],
  ['missile-silo','Missile silo','Single missile and launch pit','<ellipse cx="16" cy="26" rx="11" ry="3.5"/><path d="M12 22V9L16 3L20 9V22L23 25H9Z"/><path d="M14.5 12H17.5V20H14.5Z" fill="#fff"/>'],
  ['mirv-launcher','MIRV launch complex','Three separating warheads',`<path d="M13 11V7L16 3L19 7V11ZM3 15V11L6 7L9 11V15ZM23 15V11L26 7L29 11V15Z"/>${stroke('M6 18L13 24M26 18L19 24M16 14V27',3)}<path d="M11 26H21V29H11Z"/>`],
  ['missile-defence','Missile defence','Radar antenna',`${stroke('M4 13Q16 1 28 13M8 17Q16 9 24 17',3)}<circle cx="16" cy="20" r="2.5"/>${stroke('M16 22V27M10 28H22',3)}`],
];

function symbol(id) {return designs.find(entry=>entry[0]===id)[3]}
function markup(id, tint = '#ffffff', size = 512) {
  const entry=designs.find(entry=>entry[0]===id);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><title>${entry[1]} marker</title><g id="faction-field"><rect width="32" height="32" fill="${tint}"/></g><rect x=".75" y=".75" width="30.5" height="30.5" fill="none" stroke="#000" stroke-width="1.5"/><g id="building-symbol" fill="#000">${symbol(id).replaceAll('#fff',tint)}</g></svg>`;
}
async function main() {
  const protocol=await fs.readFile(path.resolve(root,'../../src/skirmish/Protocol.ts'),'utf8');
  const declaration=protocol.split('export type BuildingType =')[1].split(';')[0];
  const types=[...declaration.matchAll(/"([a-z-]+)"/g)].map(match=>match[1]);
  if(types.length!==designs.length||types.some(id=>!designs.some(entry=>entry[0]===id)))throw Error('BuildingType catalog is not fully covered');
  if(new Set(designs.map(entry=>entry[3])).size!==designs.length)throw Error('Two buildings share the same source symbol');
  const rules=await fs.readFile(path.resolve(root,'../../src/skirmish/Rules.ts'),'utf8');
  const glyphs=Object.fromEntries([...rules.split('export const BUILDING_RULES:')[1].split('export const SHIP_RULES:')[0].matchAll(/(?:"([a-z-]+)"|\b([a-z]+)):\s*\{\s*name:\s*"[^"]+",\s*glyph:\s*"([^"]+)"/g)].map(m=>[m[1]||m[2],m[3]]));
  await fs.mkdir(path.join(root,'svg'),{recursive:true});await fs.mkdir(path.join(root,'png'),{recursive:true});
  const frames={},assets=[],atlas=[],maskPixels=[];
  for(const [index,[id,label,meaning]] of designs.entries()) {
    const svg=markup(id);await fs.writeFile(path.join(root,'svg',`${id}.svg`),svg+'\n');
    await sharp(Buffer.from(svg)).png().toFile(path.join(root,'png',`${id}.png`));
    const tile=await sharp(Buffer.from(svg)).resize(128,128).png().toBuffer();
    const x=(index%7)*128,y=Math.floor(index/7)*128;atlas.push({input:tile,left:x,top:y});frames[id]={x,y,width:128,height:128};
    const {data,info}=await sharp(tile).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let colored=0,nonopaque=0;for(let i=0;i<data.length;i+=4){if(data[i]!==data[i+1]||data[i+1]!==data[i+2])colored++;if(data[i+3]!==255)nonopaque++}
    if(colored||nonopaque||info.width!==128)throw Error(`Invalid marker ${id}`);
    const small=await sharp(Buffer.from(svg)).resize(18,18).removeAlpha().raw().toBuffer();
    maskPixels.push({id,data:small});assets.push({id,label,meaning,previousGlyph:glyphs[id],svg:`svg/${id}.svg`,png:`png/${id}.png`});
  }
  await sharp({create:{width:896,height:384,channels:4,background:'#fff'}}).composite(atlas).png().toFile(path.join(root,'Building_Markers_Atlas.png'));
  const similarities=[];for(let i=0;i<maskPixels.length;i++)for(let j=i+1;j<maskPixels.length;j++){
    let same=0,total=0;for(let y=2;y<16;y++)for(let x=2;x<16;x++){const p=(y*18+x)*3,a=maskPixels[i].data[p]<128,b=maskPixels[j].data[p]<128;if(a||b){total++;if(a&&b)same++}}
    similarities.push({a:maskPixels[i].id,b:maskPixels[j].id,darkPixelIntersectionOverUnion:Math.round(same/total*1000)/1000});
  }
  similarities.sort((a,b)=>b.darkPixelIntersectionOverUnion-a.darkPixelIntersectionOverUnion);
  const manifest={schemaVersion:1,ageVariants:false,count:assets.length,sourceSize:512,viewBox:32,runtimeMarkerSize:18,atlas:'Building_Markers_Atlas.png',atlasSize:{width:896,height:384},grid:{columns:7,rows:3,cellSize:128},palette:{symbol:'#000000',field:'#ffffff',tint:'multiply RGB; preserve alpha'},frames,assets};
  await fs.writeFile(path.join(root,'building-markers.json'),JSON.stringify(manifest,null,2)+'\n');
  await fs.writeFile(path.join(root,'Asset_Validation.json'),JSON.stringify({passed:true,buildingTypeCoverage:types.length,grayscaleAndOpaque:assets.length,uniqueSourceShapes:assets.length,reviewSizes:[18,24,32],closestPairsAt18px:similarities.slice(0,8),scope:'Coverage and raster invariants; readability requires visual review.'},null,2)+'\n');
  // Overview and exact-size review use the final exported geometry.
  let overview='<rect width="1120" height="840" fill="#17231e"/><text x="24" y="42" font-family="Segoe UI,Arial,sans-serif" font-size="27" fill="#edf1e9">BUILDING MARKERS</text><text x="24" y="68" font-family="Segoe UI,Arial,sans-serif" font-size="15" fill="#b6c4b9">21 distinct symbols · one style across ages · black symbols on faction-tintable fields</text>';
  designs.forEach(([id,label],index)=>{const x=20+(index%7)*157,y=92+Math.floor(index/7)*244;overview+=`<rect x="${x}" y="${y}" width="148" height="230" rx="8" fill="#293a2f"/><svg x="${x+26}" y="${y+26}" width="96" height="96" viewBox="0 0 32 32">${markup(id).split('<title>')[1].split('</title>')[1].split('</svg>')[0]}</svg><text x="${x+74}" y="${y+152}" text-anchor="middle" fill="#edf1e9" font-family="Segoe UI,Arial,sans-serif" font-size="${label.length>16?11:13}">${label}</text><text x="${x+74}" y="${y+181}" text-anchor="middle" fill="#b6c4b9" font-family="Segoe UI,Arial,sans-serif" font-size="12">18 / 24 / 32 px</text>${[18,24,32].map((size,column)=>`<svg x="${x+24+column*42-size/2}" y="${y+204-size/2}" width="${size}" height="${size}" viewBox="0 0 32 32">${markup(id).split('<title>')[1].split('</title>')[1].split('</svg>')[0]}</svg>`).join('')}`});
  const overviewSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="840">${overview}</svg>`;
  await fs.writeFile(path.join(root,'overview.svg'),overviewSvg);await sharp(Buffer.from(overviewSvg)).png().toFile(path.join(root,'overview.png'));
  let review='<rect width="1050" height="916" fill="#17231e"/><text x="24" y="36" font-family="Segoe UI,Arial,sans-serif" font-size="23" fill="#edf1e9">EXACT-SIZE MARKER REVIEW</text><text x="24" y="60" font-family="Segoe UI,Arial,sans-serif" font-size="14" fill="#b6c4b9">18 px is the current in-game marker size. Labels are review aids.</text>';
  ['Building','Old letter / 18','New / 18','24 px','32 px','Faction tint / 18'].forEach((label,i)=>review+=`<text x="${[24,295,420,535,650,815][i]}" y="92" fill="#d7c29a" font-family="Segoe UI,Arial,sans-serif" font-size="13">${label}</text>`);
  designs.forEach(([id,label],row)=>{const y=110+row*37;review+=`<rect x="16" y="${y}" width="1018" height="33" fill="${row%2?'#27382d':'#203026'}"/><text x="24" y="${y+22}" fill="#edf1e9" font-family="Segoe UI,Arial,sans-serif" font-size="14">${label}</text><rect x="325" y="${y+8}" width="18" height="18" fill="#142c37" stroke="#62d5cc" stroke-width="1.5"/><text x="334" y="${y+21}" text-anchor="middle" fill="#62d5cc" font-family="Arial,sans-serif" font-weight="bold" font-size="11">${glyphs[id]}</text>`;[[18,444],[24,554],[32,668],[18,815,'#62d5cc'],[18,860,'#ee776b'],[18,905,'#edbb62'],[18,950,'#3f7ea8']].forEach(([size,x,tint])=>review+=`<svg x="${x-size/2}" y="${y+(33-size)/2}" width="${size}" height="${size}" viewBox="0 0 32 32">${markup(id,tint).split('<title>')[1].split('</title>')[1].split('</svg>')[0]}</svg>`)});
  const reviewSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="916">${review}</svg>`;await fs.writeFile(path.join(root,'small-size-review.svg'),reviewSvg);await sharp(Buffer.from(reviewSvg)).png().toFile(path.join(root,'small-size-review.png'));
  console.log(JSON.stringify({count:assets.length,coverage:'PASS',output:root,closestPairsAt18px:similarities.slice(0,3)},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1});
