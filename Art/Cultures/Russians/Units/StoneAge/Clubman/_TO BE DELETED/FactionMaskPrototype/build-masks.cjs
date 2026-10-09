const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.env.CLUBMAN_IMAGE_LIB || 'C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const root = path.resolve(__dirname, '../../../../../../..');
const output = __dirname;
const runtime = path.join(root, 'Art/Runtime/Russians/Troops/StoneAge-Clubman');
// Clubman-specific fabric material: red woven cap/sleeves, excluding orange skin/leather.
// This is deliberately not a classifier for other troops or fabric colors.
function fabric(r,g,b,a) {
  if (!a || r < 12) return 0;
  const lo = Math.min(g,b), delta = r-lo;
  if (delta <= 0 || r < Math.max(g,b)) return 0;
  const hue = (g-b)/delta/6;
  if (hue < -0.035 || hue > 0.04) return 0;
  return Math.max(0, Math.min(1, (0.66-g/r)/0.18));
}
// Retain connected fabric panels, rejecting disconnected red skin/leather shadows.
function keepFabricPanels(mask,width,height) {
  const seen=new Uint8Array(mask.length), keep=new Uint8Array(mask.length);
  for(let frame=0;frame<width/128;frame++) {
    const components=[];
    for(let y=0;y<height;y++) for(let x=frame*128;x<(frame+1)*128;x++) {
      const start=y*width+x;
      if(seen[start] || mask[start]<128) continue;
      const q=[start];seen[start]=1;
      for(let k=0;k<q.length;k++) {
        const p=q[k],px=p%width,py=Math.floor(p/width);
        for(const [nx,ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]) {
          if(nx<frame*128||nx>=(frame+1)*128||ny<0||ny>=height)continue;
          const n=ny*width+nx;
          if(!seen[n] && mask[n]>=128){seen[n]=1;q.push(n);}
        }
      }
      components.push(q);
    }
    const panels=components.filter(q=>q.length>=100);
    
    const cap=panels.toSorted((a,b)=>b.length-a.length)[0];
    const top=cap ? Math.min(...cap.map(p=>Math.floor(p/width))) : 0;
    const center=cap ? cap.reduce((s,p)=>s+p%width,0)/cap.length : frame*128+64;
    for(const q of components) {
      const upperBack=q.length>=6 && q.every(p=>Math.floor(p/width)<top && Math.floor(p/width)>=top-18 && Math.abs(p%width-center)<13);
      if(q.length>=100 || upperBack)for(const p of q)keep[p]=1;
    }
  }
  const refined=Buffer.alloc(mask.length);
  for(let p=0;p<mask.length;p++)if(keep[p]) {
    const x=p%width,y=Math.floor(p/width);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
      if(x+dx<0||x+dx>=width||y+dy<0||y+dy>=height)continue;
      const n=(y+dy)*width+x+dx;refined[n]=mask[n];
    }
  }
  return refined;
}
function recolor(src, mask, rgb) {
  const dst = Buffer.from(src);
  const top = Math.max(...rgb);
  for(let i=0,j=0;i<src.length;i+=4,j++) {
    const m = mask[j]/255;
    if (!m) continue;
    const v = Math.max(src[i],src[i+1],src[i+2]);
    for(let c=0;c<3;c++) dst[i+c]=Math.round(src[i+c]*(1-m)+rgb[c]*v/top*m);
  }
  return dst;
}
(async()=>{
  const report={stage:'art prototype; no renderer integration', semanticGuide:'Fabric-Semantic-Guide.png', selection:'woven cap crown, sleeves, and visible red tunic; excludes fur, skin, leather, weapons', encoding:'8-bit grayscale: 0 unchanged, 255 full recolor; intermediate coverage at boundaries; original alpha preserved separately', sheets:[]};
  const previews=[];
  for(const clip of ['idle','running','attack','death']) {
    const source=path.join(runtime,clip+'.png');
    const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let mask=Buffer.alloc(info.width*info.height);
    let count=0;
    for(let i=0,j=0;i<data.length;i+=4,j++) {mask[j]=Math.round(fabric(...data.subarray(i,i+4))*255);if(mask[j])count++;}
    mask=keepFabricPanels(mask,info.width,info.height); count=mask.reduce((n,v)=>n+(v>0),0);
    const maskName=clip+'.fabric-mask.png';
    await sharp(mask,{raw:{width:info.width,height:info.height,channels:1}}).png().toFile(path.join(output,maskName));
    const variants=[];
    for(const [name,rgb] of [['blue',[45,105,245]],['green',[45,185,85]],['purple',[180,75,235]],['white',[235,235,235]]]) {
      const result=recolor(data,mask,rgb);
      for(let i=0,j=0;i<data.length;i+=4,j++) {
        if(result[i+3]!==data[i+3]) throw Error('Alpha changed');
        if(!mask[j] && !result.subarray(i,i+4).equals(data.subarray(i,i+4))) throw Error('Unmasked pixel changed');
      }
      const png=await sharp(result,{raw:info}).png().toBuffer();
      await fs.writeFile(path.join(output,clip+'.'+name+'.preview.png'),png);
      variants.push(png);
    }
    const original=await fs.readFile(source);
    if(clip==='idle') {
      for(const png of [original,...variants]) previews.push({input:png,left:0,top:previews.length*info.height});
    }
    report.sheets.push({clip,source:path.relative(root,source).replaceAll('\\','/'),mask:maskName,width:info.width,height:info.height,selectedPixels:count,sha256:require('node:crypto').createHash('sha256').update(data).digest('hex'),checks:['matching dimensions','alpha unchanged in previews','unmasked pixels byte-identical']});
  }
  await sharp({create:{width:768,height:640,channels:4,background:'#20242b'}}).composite(previews).png().toFile(path.join(output,'Color-Comparison.png'));
  await fs.writeFile(path.join(output,'Validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.sheets));
})().catch(e=>{console.error(e);process.exitCode=1});


