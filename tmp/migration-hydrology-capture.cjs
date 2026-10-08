const {chromium} = require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const cases = JSON.parse(fs.readFileSync('outputs/migration-review/Variety-Layouts.json','utf8'));
const split = cases.find(c=>c.sizes[2].pattern==='split').seed;
const prefix = process.env.CAPTURE_PREFIX || 'Variety';
const targets = process.argv.length > 2 ? [{seed:Number(process.argv[2]),size:500},{seed:Number(process.argv[2]),size:1000},{seed:2,size:1000}] : [{seed:2036862757,size:500},{seed:2036862757,size:1000},{seed:split,size:1000}];
(async()=>{
 const results=[];
 for(const {seed,size} of targets){
  const browser=await chromium.launch({executablePath:'C:/Users/Damien/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
   const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
   await page.addInitScript(()=>{
    const context=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,options){
     return context.call(this,type,type==='2d'?{...options,willReadFrequently:true}:options);
    };
    const original=window.requestAnimationFrame.bind(window), pending=[];
    window.captureResume=()=>{window.captureFrozen=false;pending.splice(0).forEach(callback=>original(callback));};
    window.requestAnimationFrame=callback=>original(time=>{
     if(window.captureFrozen)pending.push(callback);else callback(time);
    });
   });
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:9001/skirmish/migration.html?seed=${seed}&size=${size}`);
   await page.waitForFunction(s=>document.querySelector('#map').dataset.ready===String(s)&&document.querySelector('#map').dataset.renderer==='webgl',seed);
   await page.waitForTimeout(7000);
   await page.evaluate(()=>window.captureFrozen=true);
   await page.waitForTimeout(500);
   // Resolve Canvas2D's deferred draw commands before the software GL compositor
   // reads its texture for the screenshot.
   await page.evaluate(()=>{const canvas=document.querySelector('#map');canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);});
   const downloading=page.waitForEvent('download');await page.locator('#save').click();
   await(await downloading).saveAs(`outputs/migration-review/${prefix}-Map-${size}-Seed-${seed}.png`);
   await page.screenshot({path:`outputs/migration-review/${prefix}-${size}-Seed-${seed}.png`,timeout:60000});
   await page.evaluate(()=>window.captureResume());
   await page.locator('#heights').click();
   await page.waitForTimeout(350);
   await page.evaluate(()=>window.captureFrozen=true);
   await page.waitForTimeout(150);
   await page.screenshot({path:`outputs/migration-review/${prefix}-Heights-${size}-Seed-${seed}.png`,timeout:60000});
   results.push({seed,size,errors,islands:await page.locator('#glade-count').textContent(),mainlands:await page.locator('#pond-count').textContent(),renderer:await page.locator('#map').getAttribute('data-renderer')});
   console.log(JSON.stringify(results.at(-1)));
  }finally{await browser.close();}
 }
 fs.writeFileSync(`outputs/migration-review/${prefix}-Browser.json`,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
