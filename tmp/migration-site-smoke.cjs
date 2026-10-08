const {chromium}=require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Users/Damien/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,options){return original.call(this,type,type==='2d'?{...options,willReadFrequently:true}:options);};});
  const response=await page.goto('http://127.0.0.1:9000/skirmish/migration.html?seed=1313198008&size=1000',{timeout:120000});
  await page.waitForFunction(()=>document.querySelector('#map')?.dataset.ready==='1313198008',{},{timeout:120000});
  console.log(JSON.stringify({http:response.status(),renderer:await page.locator('#map').getAttribute('data-renderer'),status:await page.locator('#status').textContent(),topography:await page.locator('#topography').textContent(),errors}));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
