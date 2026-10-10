const fs=require('fs');const {chromium}=require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],missing=[];
page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)missing.push({status:r.status(),url:r.url()});});
await page.goto('http://127.0.0.1:9000/skirmish/index.html',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForTimeout(2500);
await page.selectOption('#map',{label:'Training Square'});await page.selectOption('#world-size','250');await page.selectOption('#opponents','1');await page.selectOption('#starting-age','Napoleonic');await page.click('#restart');await page.waitForTimeout(9000);
const canvas=page.locator('#battlefield'),box=await canvas.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);for(let i=0;i<20;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(60);}await page.waitForTimeout(2500);await page.keyboard.press('Control+a');await page.waitForTimeout(1000);
await page.screenshot({path:'.codex/FormationFixes/runtime-napoleonic.png'});
await page.mouse.click(box.x+box.width*.62,box.y+box.height*.55,{button:'right'});await page.waitForTimeout(2500);
await page.screenshot({path:'.codex/FormationFixes/runtime-movement.png'});
const art=await page.evaluate(async()=>{
 const {TroopActors}=await import('/src/skirmish/client/troops/TroopActors.ts');const {RUSSIAN_TROOP_ACTORS}=await import('/src/skirmish/client/troops/RussianTroopCatalogue.ts');
 const actors=new TroopActors(()=>0,{troops:[...RUSSIAN_TROOP_ACTORS.values()],byDefinitionId:RUSSIAN_TROOP_ACTORS});await actors.load();return {actors:RUSSIAN_TROOP_ACTORS.size,loaded:[...RUSSIAN_TROOP_ACTORS.keys()].filter(id=>actors.isLoaded(id)).length};
});
const result={text:(await page.locator('body').innerText()).slice(0,4000),art,errors,missing};fs.writeFileSync('.codex/FormationFixes/runtime-browser-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();if(errors.length||missing.length)process.exitCode=1;})().catch(e=>{console.error(e);process.exit(1)});
