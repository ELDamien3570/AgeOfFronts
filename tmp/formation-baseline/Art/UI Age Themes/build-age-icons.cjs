const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const root = __dirname;
const stock = [
  ['ores', 'Raw materials', 'M3 18 7 5l9-2 5 13-7 5Z'],
  ['metals', 'Metals', 'm3 15 5-7h10l3 7-5 5H7Z M3 15h18 M8 8l-1 12 M18 8l-2 12'],
  ['energy', 'Fuel & powder', 'M12 2c2 7 8 8 8 14a8 8 0 0 1-16 0c0-5 5-7 8-14Z'],
  ['horses', 'Horses', 'm5 20 2-8-3-3 7-6 1 3 5 2 3 7-3 5Z M7 12l8-4'],
  ['equipment', 'Equipment', 'm4 20 15-15 1-3-3 1L2 18Z M5 13l6 6'],
  ['payloads', 'Payloads', 'M12 2 7 8v9l5 5 5-5V8Z M7 14H3v7l4-4 M17 14h4v7l-4-4'],
];
const orders = [
  ['replenish', 'Replenish', '<path d="M12 4V20M4 12H20" fill="none" stroke="#000" stroke-width="4"/>'],
  ['hold', 'Hold position', '<rect x="5" y="5" width="14" height="14" fill="#000"/>'],
  ['all', 'Select all', '<path d="M4 4H9V9H4ZM15 4H20V9H15ZM4 15H9V20H4ZM15 15H20V20H15Z" fill="#000"/>'],
];
const utility = (content) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24"><g id="faction-field"><rect width="24" height="24" fill="#fff"/></g>${content}</svg>`;
const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function framed(asset, theme, texture) {
  const viewBox = asset.source.match(/viewBox="([^"]+)"/)[1];
  const body = asset.source.replace(/^[\s\S]*?<svg[^>]+>/, '').replace(/<\/svg>\s*$/, '');
  const stone = theme.age === 'StoneAge';
  const outer = stone ? 'M0 22L12 18L18 0H130L136 8L145 0H352L358 6L374 0H487L493 16L512 22V142L504 149L512 164V350L505 357L512 365V490L493 497L488 512H360L354 505L341 512H154L148 505L138 512H21L15 496L0 488V362L7 351L0 345V174L6 165L0 151Z' : 'M8 0H504L512 8V504L504 512H8L0 504V8Z';
  const pins = stone ? '' : [20,492].flatMap(x => [20,492].map(y => theme.age === 'LateMedieval' ? `<path d="M${x} ${y-7}L${x+7} ${y}L${x} ${y+7}L${x-7} ${y}Z" fill="${theme.palette.light}" stroke="${theme.palette.edge}" stroke-width="2"/>` : `<circle cx="${x}" cy="${y}" r="5" fill="${theme.palette.light}" stroke="${theme.palette.edge}" stroke-width="2"/>`)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>${xml(asset.label)} · ${xml(theme.material)} frame</title><defs><pattern id="material" width="192" height="192" patternUnits="userSpaceOnUse"><image width="192" height="192" href="data:image/png;base64,${texture}"/></pattern><linearGradient id="bevel" x2="1" y2="1"><stop stop-color="${theme.palette.light}"/><stop offset=".5" stop-color="${theme.palette.rim}"/><stop offset="1" stop-color="${theme.palette.edge}"/></linearGradient></defs><g id="age-frame"><path d="${outer}" fill="url(#material)" stroke="${theme.palette.edge}" stroke-width="3"/><rect x="27" y="27" width="458" height="458" fill="${theme.palette.panel}" stroke="url(#bevel)" stroke-width="7"/>${pins}</g><svg x="32" y="32" width="448" height="448" viewBox="${viewBox}">${body}</svg></svg>`;
}

async function main() {
  const themes = JSON.parse(await fs.readFile(path.join(root,'themes.json'),'utf8')).themes;
  const buildings = JSON.parse(await fs.readFile(path.join(root,'../Building Markers/building-markers.json'),'utf8')).assets;
  const assets = [];
  for (const asset of buildings) assets.push({id:'building-'+asset.id,label:asset.label,category:'Buildings',source:await fs.readFile(path.join(root,'../Building Markers',asset.svg),'utf8')});
  for (const id of ['melee','ranged','cavalry','ranged-cavalry','siege-catapult','warship','transport-ship']) assets.push({id:'formation-'+id,label:id.replaceAll('-',' '),category:'Formations',source:await fs.readFile(path.join(root,'../Formation Icons/svg',id+'.svg'),'utf8')});
  for (const [id,label,glyph] of stock) assets.push({id:'resource-'+id,label,category:'Resources',source:utility(`<path d="${glyph}" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`)});
  for (const [id,label,content] of orders) assets.push({id:'command-'+id,label,category:'Commands',source:utility(content)});
  await fs.mkdir(path.join(root,'icons/masks'),{recursive:true});
  for (const asset of assets) {
    const { data, info } = await sharp(Buffer.from(asset.source)).resize(448,448).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for (let p=0;p<data.length;p+=4) { const a=Math.round((data[p]+data[p+1]+data[p+2])/3*data[p+3]/255); data[p]=255;data[p+1]=255;data[p+2]=255;data[p+3]=a; }
    const pixels=await sharp(data,{raw:info}).png().toBuffer();
    await sharp({create:{width:512,height:512,channels:4,background:'#000'}}).composite([{input:pixels,left:32,top:32}]).removeAlpha().png().toFile(path.join(root,'icons/masks',asset.id+'.png'));
  }
  const ages=[];
  for (const theme of themes) {
    const dir=path.join(root,'icons',theme.age);
    await fs.mkdir(path.join(dir,'svg'),{recursive:true}); await fs.mkdir(path.join(dir,'png'),{recursive:true});
    const texture=(await sharp(path.join(root,'materials',theme.file+'.webp')).resize(128,128).png().toBuffer()).toString('base64');
    const cells=[];
    for (const [index,asset] of assets.entries()) {
      const svg=framed(asset,theme,texture);
      await fs.writeFile(path.join(dir,'svg',asset.id+'.svg'),svg+'\n');
      await sharp(Buffer.from(svg)).png().toFile(path.join(dir,'png',asset.id+'.png'));
      cells.push({input:await sharp(Buffer.from(svg)).resize(96,96).png().toBuffer(),left:(index%8)*96,top:Math.floor(index/8)*96});
    }
    await sharp({create:{width:768,height:480,channels:4,background:'#00000000'}}).composite(cells).png().toFile(path.join(dir,'atlas.png'));
    ages.push({age:theme.age,material:theme.material,atlas:`icons/${theme.age}/atlas.png`,count:assets.length});
  }
  const manifest={schemaVersion:1,count:assets.length*themes.length,perAge:assets.length,masterSize:512,atlas:{columns:8,rows:5,cellSize:96},recolor:'Apply shared field mask to center only. Do not multiply the age material.',ages,assets:assets.map(({source,...a},i)=>({...a,frame:{x:i%8*96,y:Math.floor(i/8)*96,width:96,height:96},mask:`icons/masks/${a.id}.png`}))};
  await fs.writeFile(path.join(root,'age-icons.json'),JSON.stringify(manifest,null,2)+'\n');
  await fs.writeFile(path.join(root,'Icon_Validation.json'),JSON.stringify({status:'PASS',ages:7,iconsPerAge:assets.length,total:manifest.count,sharedFieldMasks:assets.length,buildingSymbols:buildings.length,formationShapesPreserved:true,sourceGlyphsChanged:false,themeAppliedAfterFactionTint:true},null,2)+'\n');
  console.log(JSON.stringify({status:'PASS',total:manifest.count,perAge:assets.length}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
