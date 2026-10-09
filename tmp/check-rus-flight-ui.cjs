const {chromium}=require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1440,height:900}}); const errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:9000/skirmish/index.html',{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('#starting-age').waitFor({timeout:60000});
 await page.selectOption('#world-size','250');await page.selectOption('#opponents','2');await page.selectOption('#starting-age','Modern');await page.selectOption('#map','thebox');await page.click('#restart');
 await page.waitForFunction(()=>!document.querySelector('#pause').disabled && document.querySelector('#spawn-selection').hidden,{},{timeout:60000});await page.waitForTimeout(2000);
 await page.locator('#canvas').count().catch(()=>0);
 await page.mouse.click(720,440);const modes=[];
 for(const [key,label] of [['i','Dispatch fighters'],['o','A-Bomb Run'],['p','Bombing Run'],['u','Drone Strike']]){
  await page.keyboard.press('Escape');await page.keyboard.press(key);await page.mouse.move(730,445);await page.waitForTimeout(150);
  const hint=await page.locator('#placement-hint').textContent();if(!hint.includes(label))throw Error(key+' routed incorrectly: '+hint);
  modes.push({key,hint});
 }
 console.log(JSON.stringify({errors,modes},null,2));if(errors.length)throw Error('Browser errors');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
