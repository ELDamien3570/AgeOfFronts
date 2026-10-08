const {chromium}=require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path');
(async()=>{
 const root=path.resolve('Art/Cultures/Russians/Units/BronzeAge/BronzeAxeman');
 const url='http://127.0.0.1:9007/Cultures/Russians/Units/BronzeAge/BronzeAxeman/Actor_Review.html?revision=bronze-mace-full-v4#attack';
 const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const p=await b.newPage({viewport:{width:1180,height:1000}});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(url);await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('All 9'));
 const clips=JSON.parse(fs.readFileSync(path.join(root,'animations.json'),'utf8')).animations;
 const frames=[];
 for(const c of clips){
  await p.locator('#clip-'+c.id).click();
  for(let i=0;i<6;i++){
   await p.locator('#scrub').evaluate((e,i)=>{e.value=i;e.dispatchEvent(new Event('input',{bubbles:true}));},i);
   const metrics=await p.locator('#actor').evaluate(e=>{
    const a=e.getContext('2d').getImageData(0,0,e.width,e.height).data;let count=0,minx=512,miny=512,maxx=0,maxy=0,edge=0;
    for(let y=0;y<512;y++)for(let x=0;x<512;x++){const alpha=a[(y*512+x)*4+3];if(alpha>16){count++;minx=Math.min(minx,x);miny=Math.min(miny,y);maxx=Math.max(maxx,x);maxy=Math.max(maxy,y);if(x<2||y<2||x>509||y>509)edge++;}}
    return {count,bounds:[minx,miny,maxx,maxy],edge};
   });
   frames.push({clip:c.id,frame:i,...metrics});
  }
 }
 const playback={};
 for(const id of ['running','charge','death','death-back']){
  await p.locator('#clip-'+id).click();await p.waitForTimeout(2500);
  playback[id]={frame:await p.locator('#frame-output').textContent(),play:await p.locator('#play').textContent()};
 }
 await p.locator('#clip-charge-attack').click();await p.locator('#scrub').evaluate(e=>{e.value=2;e.dispatchEvent(new Event('input',{bubbles:true}));});
 await p.screenshot({path:path.join(root,'Review-Mace-Full-v4-Attack.png'),fullPage:true});
 await p.locator('#clip-death-back').click();await p.locator('#scrub').evaluate(e=>{e.value=5;e.dispatchEvent(new Event('input',{bubbles:true}));});
 await p.screenshot({path:path.join(root,'Review-Mace-Full-v4-Corpse.png'),fullPage:true});
 const report={url,status:await p.locator('#status').textContent(),errors,frames,playback};
 fs.writeFileSync(path.join(root,'Mace-Full-v4-Browser-Review.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,errors,clipped:frames.filter(x=>x.edge>0),empty:frames.filter(x=>!x.count),playback},null,2));
 await b.close();
})();
