const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = __dirname;
const url = 'http://127.0.0.1:9007/Cultures/Russians/Units/StoneAge/Clubman/';
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page = await browser.newPage({viewport:{width:1360,height:1100}});
  const errors=[];
  await page.route('**/favicon.ico', route=>route.fulfill({status:204,body:''}));
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  await page.goto(url+'Actor_Review.html?revision=overhead-v2');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('All 9 clips loaded'));
  const metadata=JSON.parse(await fs.readFile(path.join(root,'animations.json'),'utf8'));
  const outputTag=metadata.artRevision.includes('windup-corpse')?'Windup-Corpse-v5':metadata.artRevision.includes('charge-arms')?'ChargeArms-v4':metadata.artRevision.includes('body-swing')?'BodySwing-v3':'Overhead-v2';
  const checks=[];
  for (const clip of metadata.animations) {
    await page.locator('#clip-'+clip.id).click();
    const duration=clip.durations.reduce((a,b)=>a+b,0);
    await page.waitForTimeout(clip.loop?350:duration+250);
    const result=await page.locator('#actor').evaluate(canvas=>{
      const a=canvas.getContext('2d').getImageData(0,0,512,512).data;
      let visible=0; for(let i=3;i<a.length;i+=4)if(a[i]>16)visible++;
      return {clip:canvas.dataset.clip,frame:Number(canvas.dataset.frame),visible};
    });
    if(result.clip!==clip.id || result.visible<100 || (!clip.loop && result.frame!==5)) throw Error('Invalid playback: '+JSON.stringify(result));
    checks.push({...result,loop:clip.loop,completed:!clip.loop});
  }
  await page.locator('#clip-charge-attack').click();
  for(let frame=0;frame<3;frame++)await page.locator('#next').click();
  await page.screenshot({path:path.join(root,'Review-'+outputTag+'-Strike.png'),fullPage:true});
  await page.locator('#clip-death-back').click();
  for(let frame=0;frame<5;frame++)await page.locator('#next').click();
  await page.screenshot({path:path.join(root,'Review-'+outputTag+'-Corpse.png'),fullPage:true});
  await page.locator('#clip-idle').click();
  await page.locator('#play').click();
  await page.screenshot({path:path.join(root,'Review-'+outputTag+'-Actor.png'),fullPage:true});
  await page.goto(url+'Formation/Formation_Review.html?revision=overhead-v2');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('loaded'));
  const formationStatus=await page.locator('#status').textContent();
  if(/failed|could not|error/i.test(formationStatus))throw Error(formationStatus);
  const tabs=page.locator('#clips button');
  const formation=[];
  for(let index=0;index<await tabs.count();index++){
    await tabs.nth(index).click(); await page.waitForTimeout(180);
    formation.push({label:await tabs.nth(index).innerText(),title:await page.locator('#clip-title').textContent()});
  }
  await page.locator('#clips button').filter({hasText:'Idle'}).click();
  await page.screenshot({path:path.join(root,'Review-'+outputTag+'-Formation.png'),fullPage:true});
  const report={revision:metadata.artRevision,actorUrl:url+'Actor_Review.html',formationUrl:url+'Formation/Formation_Review.html',checks,formation,formationStatus,errors,scope:'Local browser art playback only; no match-runtime or artistic acceptance claim.'};
  await fs.writeFile(path.join(root,outputTag+'-Browser-Review.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  await browser.close();
  if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});

