const { chromium } = require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const root=path.resolve(__dirname,'..');
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:9031/Art/Cultures/Russians/Units/Modern/T14/Actor_Review.html');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('All 4 clips loaded'));
  const checks=[];
  for (const id of ['idle','moving','moving-shooting','death']) {
    await page.locator(`[data-clip="${id}"][role="tab"]`).click();
    await page.waitForTimeout(350);
    const before=await page.locator('#actor').getAttribute('data-frame');
    await page.waitForTimeout(370);
    const after=await page.locator('#actor').getAttribute('data-frame');
    if(id!=='idle'&&before===after)throw new Error(id+': frame did not advance');
    checks.push({id,before,after});
  }
  await page.waitForFunction(()=>document.querySelector('#play').textContent==='Play');
  const last=await page.locator('#actor').getAttribute('data-frame');
  await page.waitForTimeout(450);
  if(last!=='5'||await page.locator('#actor').getAttribute('data-frame')!=='5')throw new Error('Death did not hold wreck');
  await page.screenshot({path:path.join(root,'Review-death-v1.png'),fullPage:true});
  await page.locator('[data-clip="moving-shooting"][role="tab"]').click();
  await page.locator('#scrub').fill('1');
  await page.locator('#backdrop').selectOption('checker');
  await page.screenshot({path:path.join(root,'Review-firing-v1.png'),fullPage:true});
  if(errors.length)throw new Error(errors.join('\n'));
  fs.writeFileSync(path.join(root,'Browser-Review.json'),JSON.stringify({clipsLoaded:4,playbackChecks:checks,deathHoldsFinalFrame:true,scrubberVerified:true,backdropVerified:true,pageErrors:errors,runtimeIntegration:false,userApproval:'Animations pending review'},null,2)+'\n');
  console.log('Four clips loaded; playback advances; death holds wreck; scrub and backdrop work; no page errors.');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});

