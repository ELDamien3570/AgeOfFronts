const { chromium } = require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve('outputs/migration-review');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/Damien/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  // Software WebGL in headless Chromium needs breathing room for screenshot
  // readback. This changes only the capture browser's frame cadence.
  await page.addInitScript(() => {
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, options) {
      return context.call(this, type, type === '2d' ? {...options, willReadFrequently: true} : options);
    };
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => setTimeout(() => frame(callback), 100);
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const results = [];
  for (const theme of (process.argv.length > 2 ? process.argv.slice(2) : ['migration', 'black-forest'])) {
    await page.goto(`http://127.0.0.1:9001/skirmish/${theme}.html?seed=3&size=500`);
    await page.waitForFunction(() => document.querySelector('#map').dataset.renderer === 'webgl' && document.querySelector('#map').dataset.ready === '3');
    await page.waitForTimeout(8000);
    if (!process.env.VALIDATE_ONLY) await page.screenshot({ path: path.join(output, `Modern-${theme}-Overview.png`) });
    console.log(`${theme}: overview captured`);
    if (!process.env.VALIDATE_ONLY) {
      const downloading = page.waitForEvent('download');
      await page.locator('#save').click();
      await (await downloading).saveAs(path.join(output, `Modern-${theme}-Map.png`));
    }
    console.log(`${theme}: PNG exported`);
    results.push(await page.evaluate(() => {
      const a = document.querySelector('#map').getBoundingClientRect(), b = document.querySelector('.ground-layer').getBoundingClientRect();
      return { theme: document.body.dataset.theme, renderer: document.querySelector('#map').dataset.renderer, aligned: a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height };
    }));
    const box = await page.locator('#map').boundingBox();
    await page.mouse.move(box.x + box.width * .63, box.y + box.height * .5);
    await page.mouse.wheel(0, -950);
    await page.waitForTimeout(2500);
    if (!process.env.VALIDATE_ONLY) await page.screenshot({ path: path.join(output, `Modern-${theme}-Detail.png`) });
  }
  // Exercise the actual shared layer's context recovery, with the 2D fallback visible.
  await page.evaluate(() => {
    window.captureContextLoss = document.querySelector('.ground-layer').getContext('webgl2').getExtension('WEBGL_lose_context');
    window.captureContextLoss.loseContext();
  });
  await page.waitForFunction(() => document.querySelector('#map').dataset.renderer === 'classic');
  await page.evaluate(() => window.captureContextLoss.restoreContext());
  await page.waitForFunction(() => document.querySelector('#map').dataset.renderer === 'webgl');
  for (const size of ['250', '1000']) {
    await page.selectOption('#size', size);
    await page.locator('#generation-controls').evaluate(form => form.requestSubmit());
    await page.waitForFunction(s => document.querySelector('#map').dataset.size === s && document.querySelector('#map').dataset.ready === '3', size);
    results.push({ size, renderer: await page.locator('#map').getAttribute('data-renderer') });
  }
  await page.close();
  const fallback = await browser.newPage();
  await fallback.bringToFront();
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' ? null : original.call(this, type, ...args); };
  });
  await fallback.goto('http://127.0.0.1:9001/skirmish/migration.html?seed=3&size=250');
  await fallback.waitForFunction(() => document.querySelector('#map').dataset.renderer === 'classic' && document.querySelector('#map').dataset.ready === '3');
  results.push({ fallback: await fallback.locator('#map').getAttribute('data-renderer'), contextRecovery: 'passed' });
  fs.writeFileSync(path.join(output, 'Modern-Validation.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }));
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
