const {chromium}=require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Users/Damien/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const results=[];
 try {
  for (const [theme,seed,size] of [['migration',614546621,1000],['migration',3,500],['migration',42,250]]) {
   const page=await browser.newPage({viewport:{width:1540,height:1100}}), errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,options){return original.call(this,type,type==='2d'?{...options,willReadFrequently:true}:options);};
    const raf=window.requestAnimationFrame.bind(window),pending=[];
    window.captureResume=()=>{window.captureFrozen=false;pending.splice(0).forEach(callback=>raf(callback));};
    window.requestAnimationFrame=callback=>raf(time=>{if(window.captureFrozen)pending.push(callback);else callback(time);});
   });
   const response=await page.goto(`http://127.0.0.1:9000/skirmish/${theme}.html?seed=${seed}&size=${size}`,{timeout:120000});
   await page.waitForFunction(seed=>document.querySelector('#map')?.dataset.ready===String(seed)&&document.querySelector('#map')?.dataset.renderer==='webgl',seed,{timeout:120000});
   await page.waitForTimeout(1500);
   await page.evaluate(()=>window.captureFrozen=true);
   const download=page.waitForEvent('download');await page.locator('#save').click();
   await(await download).saveAs(`outputs/migration-review/Formation-${theme}-${size}-Seed-${seed}.png`);
   await page.screenshot({path:`outputs/migration-review/Formation-${theme}-${size}-Seed-${seed}-Preview.png`,timeout:60000});
   await page.evaluate(()=>window.captureResume());
   await page.locator('#heights').click();
   await page.waitForTimeout(200);await page.evaluate(()=>window.captureFrozen=true);
   await page.screenshot({path:`outputs/migration-review/Formation-${theme}-${size}-Seed-${seed}-Heights.png`,timeout:60000});
   results.push({theme,seed,size,http:response.status(),errors,renderer:await page.locator('#map').getAttribute('data-renderer'),deposits:await page.locator('#map').getAttribute('data-deposits'),generationMs:await page.locator('#map').getAttribute('data-generation-ms'),legend:await page.locator('#resource-legend').innerText(),filter:await page.locator('#resource-filter').inputValue()});
   console.log(JSON.stringify(results.at(-1)));await page.close();
  }
 }finally{await browser.close();}
 fs.writeFileSync('outputs/migration-review/Resource-Geography-Browser.json',JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
