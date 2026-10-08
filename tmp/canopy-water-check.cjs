const {chromium}=require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Users/Damien/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe',headless:true});try{
 const page=await browser.newPage();await page.route('**/canopy-check',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Canopy check</title>'}));await page.goto('http://127.0.0.1:9000/canopy-check');
 const result=await page.evaluate(async()=>{
  const {generateMigration}=await import('/src/skirmish/MigrationMap.ts'),{PaintedTerrain}=await import('/src/skirmish/client/PaintedTerrain.ts');
  const loaded=generateMigration(500,2036862757),canvas=document.createElement('canvas');canvas.width=750;canvas.height=750;
  const ctx=canvas.getContext('2d'),paint=new PaintedTerrain(loaded.map,undefined,loaded.environment);paint.setDecorationsOnly(true);
  paint.draw(ctx,1.5,0,0,750,750);await new Promise(r=>setTimeout(r,4000));ctx.clearRect(0,0,750,750);paint.draw(ctx,1.5,0,0,750,750);
  const pixels=ctx.getImageData(0,0,750,750).data;let errors=0;const examples=[];
  for(let y=3;y<497;y++)for(let x=3;x<497;x++){
   if(loaded.map.isLand(loaded.map.ref(x,y)))continue;let near=false;
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(loaded.map.isLand(loaded.map.ref(x+dx,y+dy)))near=true;
   if(near)continue;const alpha=pixels[(Math.floor((y+.5)*1.5)*750+Math.floor((x+.5)*1.5))*4+3];
   if(alpha>20){errors++;if(examples.length<10)examples.push({x,y,alpha});}
  }
  return {errors,examples,image:canvas.toDataURL()};
 });
 fs.writeFileSync('outputs/migration-review/Canopy-Water-Check.png',Buffer.from(result.image.split(',')[1],'base64'));delete result.image;console.log(JSON.stringify(result));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
