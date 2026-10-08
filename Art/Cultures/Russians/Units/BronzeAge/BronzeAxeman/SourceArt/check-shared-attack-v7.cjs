const {chromium}=require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path');
(async()=>{
const root=path.resolve('Art/Cultures/Russians/Units/BronzeAge/BronzeAxeman');
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:9007/Cultures/Russians/Units/BronzeAge/BronzeAxeman/Actor_Review.html?revision=bronze-mace-shared-attack-v7#attack');
await p.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('All 9'));
const rendered={};
for(const id of ['attack','charge-attack']){
 await p.locator('#clip-'+id).click();rendered[id]=[];
 for(let i=0;i<6;i++){await p.locator('#scrub').evaluate((e,i)=>{e.value=i;e.dispatchEvent(new Event('input',{bubbles:true}));},i);rendered[id].push(await p.locator('#actor').evaluate(e=>e.toDataURL()));}
}
const identical=rendered.attack.every((frame,i)=>frame===rendered['charge-attack'][i]);
if(!identical||errors.length)throw new Error('Shared attack mismatch '+errors);
fs.writeFileSync(path.join(root,'Shared-Attack-v7-Browser-Review.json'),JSON.stringify({identicalFrames:6,errors,status:await p.locator('#status').textContent()},null,2));
console.log('Both attack slots render identical pixels in all six frames; no page errors.');
await b.close();
})();
