const {chromium}=require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[],assets=[];
 await page.addInitScript(()=>{window.__troopDraws={};const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(image?.src && (image.src.includes('/Troops/') || /\/(idle|running|attack|death)-[A-Za-z0-9_-]+\.png/.test(image.src)))window.__troopDraws[image.src]=(window.__troopDraws[image.src]??0)+1;return draw.call(this,image,...args)}});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if((r.url().includes('/Troops/') && !r.url().includes('?')) || /\/(idle|running|attack|death)-[A-Za-z0-9_-]+\.png/.test(r.url())) assets.push({url:r.url(),status:r.status()})});
 await page.goto(process.env.TEST_URL ?? 'http://127.0.0.1:9019/skirmish/index.html',{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('#starting-age').waitFor({timeout:60000});
 await page.selectOption('#world-size','250');await page.selectOption('#opponents','2');await page.selectOption('#starting-age',process.env.TEST_AGE??'StoneAge');
 await page.selectOption('#map','thebox');await page.click('#restart');await page.waitForFunction(()=>!document.querySelector('#pause').disabled && document.querySelector('#spawn-selection').hidden,{},{timeout:60000});await page.waitForTimeout(3000);
 await page.mouse.move(720,375);for(let i=0;i<9;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(40)}await page.waitForTimeout(2000);
 await page.click('#all');await page.waitForTimeout(400);await page.click('[data-shape="line"]');await page.mouse.move(720,430);await page.waitForTimeout(1000);await page.screenshot({path:'tmp/NormalTroops-Close.png'});
 for(let i=0;i<15;i++){await page.mouse.wheel(0,120);await page.waitForTimeout(30)}await page.waitForTimeout(400);const lodBefore=await page.evaluate(()=>JSON.stringify(window.__troopDraws));await page.waitForTimeout(400);const lodAfter=await page.evaluate(()=>JSON.stringify(window.__troopDraws));
 console.log(JSON.stringify({errors,assets,lodStopped:lodBefore===lodAfter,draws:await page.evaluate(()=>window.__troopDraws),controls:await page.locator('.troop-formation-controls').count()},null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
