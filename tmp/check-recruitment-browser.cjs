const {chromium} = require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page = await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:9019/skirmish/index.html',{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('#starting-age').waitFor({timeout:60000});
 const ages=await page.locator('#starting-age option').evaluateAll(nodes=>nodes.map(n=>n.value));
 await page.selectOption('#world-size','250');await page.selectOption('#opponents','2');await page.selectOption('#starting-age','PostModern');
 await page.click('#restart');await page.waitForTimeout(13500);
 await page.mouse.move(700,400);await page.mouse.wheel(0,-950);await page.waitForTimeout(700);
 const specialists=await page.locator('[data-dock-action="support"]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.value,label:n.textContent,disabled:n.disabled})));
 await page.hover('#build-barracks');await page.waitForTimeout(300);
 const tooltip=await page.locator('.tooltip-art img').evaluateAll(nodes=>nodes.map(n=>n.src));
 await page.screenshot({path:'tmp/RussianRecruitment-FinalPreview.png'});
 const portraits=await page.locator('[id^="recruit-"] img').evaluateAll(nodes=>nodes.map(n=>n.src));
 console.log(JSON.stringify({ages,specialists,tooltip,portraits,errors},null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
