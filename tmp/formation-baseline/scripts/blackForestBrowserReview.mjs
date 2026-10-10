import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.BLACK_FOREST_PLAYWRIGHT ?? "playwright",
);
const output = fileURLToPath(
  new URL("../outputs/black-forest-review/", import.meta.url),
);
const baseUrl = process.env.BLACK_FOREST_URL ?? "http://127.0.0.1:9000";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BLACK_FOREST_BROWSER,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [],
  failures = [],
  diagnostics = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.status() >= 400)
    failures.push(`${response.status()} ${response.url()}`);
});
page.on("console", (message) => {
  if (message.type() === "error")
    errors.push({ text: message.text(), location: message.location() });
  try {
    const value = JSON.parse(message.text());
    if (value.event === "browser-runtime-diagnostics") diagnostics.push(value);
  } catch {}
});
try {
  await page.goto(`${baseUrl}/skirmish/black-forest.html?seed=42&size=250`, {
    waitUntil: "networkidle",
  });
  await page.locator("canvas[data-ready='42']").waitFor();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${output}/Overview.png`, fullPage: true });
  const metrics = await page.locator("aside").innerText();
  const generationMs = await page
    .locator("#map")
    .getAttribute("data-generation-ms");
  await page.getByRole("button", { name: "Explore glade" }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/Glade.png`, fullPage: true });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Show paths", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${output}/Paths.png`, fullPage: true });
  await page.getByRole("button", { name: "New seed" }).click();
  await page.waitForFunction(
    () => document.querySelector("#map").dataset.ready !== "42",
  );
  const rerolled = await page.locator("#map").getAttribute("data-ready");
  await page.locator("#seed").fill("42");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await page.locator("canvas[data-ready='42']").waitFor();
  const mapExport = await page.locator("#map").screenshot();
  await writeFile(`${output}/Map.png`, mapExport);
  const thumbnailDirectory = fileURLToPath(
    new URL("../resources/maps/black-forest/", import.meta.url),
  );
  await mkdir(thumbnailDirectory, { recursive: true });
  const downloadPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save image", exact: true }).click();
  const download = await downloadPending;
  await download.saveAs(`${thumbnailDirectory}/lobby-preview.png`);
  const play = await page.locator("#play").getAttribute("href");
  const sizes = [];
  for (const size of [500, 1000]) {
    await page.locator("#size").selectOption(String(size));
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await page
      .locator(`canvas[data-size='${size}'][data-ready='42']`)
      .waitFor();
    await page.waitForLoadState("networkidle");
    sizes.push({
      size,
      generationMs: Number(
        await page.locator("#map").getAttribute("data-generation-ms"),
      ),
      play: await page.locator("#play").getAttribute("href"),
    });
    await page.getByRole("button", { name: "Explore glade" }).click();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `${output}/Glade-${size}.png`,
      fullPage: true,
    });
  }
  const waterPatterns = [];
  await page.locator("#size").selectOption("250");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Show paths", exact: true }).click();
  for (let seed = 0; seed < 24 && waterPatterns.length < 3; seed++) {
    await page.locator("#seed").fill(String(seed));
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await page
      .locator(`canvas[data-size='250'][data-ready='${seed}']`)
      .waitFor();
    const mode = await page.locator("#map").getAttribute("data-pond-mode");
    if (waterPatterns.some((pattern) => pattern.mode === mode)) continue;
    await page.waitForTimeout(200);
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save image", exact: true }).click();
    const variant = await pending;
    await variant.saveAs(`${output}/Ponds-${mode}.png`);
    if (mode === "near-all")
      await variant.saveAs(`${thumbnailDirectory}/lobby-preview.png`);
    waterPatterns.push({
      seed,
      mode,
      count: await page.locator("#pond-count").innerText(),
    });
  }
  if (waterPatterns.length !== 3)
    throw new Error("Did not observe all three water patterns");
  const matchSeed = waterPatterns.find(
      (pattern) => pattern.mode === "near-all",
    ).seed,
    matchPlay = `/skirmish/index.html?map=black-forest&seed=${matchSeed}&size=250`;
  await page.goto(`${baseUrl}${matchPlay}&diagnostics=1`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#loading")?.hidden === true &&
      document.querySelector("#spawn-selection")?.hidden === true,
    null,
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () => {
      const clock = document.querySelector("#clock")?.textContent;
      return clock && clock !== "0:00";
    },
    null,
    { timeout: 30_000 },
  );
  const clock = await page.locator("#clock").innerText();
  if (
    !diagnostics.some(
      (value) => value.map === "black-forest" && value.seed === matchSeed,
    )
  )
    throw new Error("Missing Black Forest match diagnostics");
  await page.screenshot({ path: `${output}/Skirmish.png`, fullPage: true });
  const result = {
    metrics,
    waterPatterns,
    sizes,
    generationMs: Number(generationMs),
    rerolled,
    play,
    matchPlay,
    clock,
    activeMatch: true,
    title: await page.locator("#map-name").innerText(),
    errors,
    failures,
    diagnostics,
  };
  await writeFile(
    `${output}/Browser-Validation.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  if (errors.length || failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
