const fs=require('fs'),path=require('path'),sharp=require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const base=path.resolve('Art/Cultures/Russians/FactionMasks/Napoleonic');
(async()=>{const m=JSON.parse(fs.readFileSync(path.join(base,'manifest.json')));for(const u of m.units){const meta=path.resolve(base,u.metadata),d=JSON.parse(fs.readFileSync(meta));let overlays=[],row=0;for(const a of d.animations){for(const [col,f]of a.frames.entries()){const s=u.sheets.find(s=>s.file===(f.sheet||a.file)),p=path.resolve(base,s.source),{data,info}=await sharp(p).extract({left:f.x,top:f.y,width:f.width,height:f.height}).ensureAlpha().raw().toBuffer({resolveWithObject:true}),mask=await sharp(path.resolve(base,s.mask.split('?')[0])).extract({left:f.x,top:f.y,width:f.width,height:f.height}).ensureAlpha().raw().toBuffer();for(let j=0;j<data.length;j+=4){const k=mask[j+3]/255,v=Math.max(data[j],data[j+1],data[j+2]);data[j]=Math.round(data[j]*(1-k)+v*.17*k);data[j+1]=Math.round(data[j+1]*(1-k)+v*.51*k);data[j+2]=Math.round(data[j+2]*(1-k)+v*k)}overlays.push({input:await sharp(data,{raw:info}).resize(170,170).png().toBuffer(),left:col*170,top:row*200+24})}overlays.push({input:Buffer.from(`<svg width="512" height="24"><text x="8" y="18" fill="white" font-size="16">${a.id}: blue all frames</text></svg>`),left:0,top:row*200});row++}const out='tmp/napoleonic-'+u.name+'-all-frames.png';await sharp({create:{width:1020,height:row*200,channels:4,background:'#383838'}}).composite(overlays).png().toFile(out);console.log(out)}})();





