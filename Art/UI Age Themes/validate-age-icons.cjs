const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp");
const root = __dirname;

async function main() {
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "age-icons.json"), "utf8"),
  );
  const failures = [];
  let pngs = 0,
    svgs = 0,
    atlases = 0,
    masks = 0;
  for (const asset of manifest.assets) {
    const { data, info } = await sharp(path.join(root, asset.mask))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== 512 || info.height !== 512)
      failures.push(asset.id + ": mask dimensions");
    let field = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const pixel = data[(y * info.width + x) * info.channels];
        if (pixel) field++;
        if ((x < 32 || x >= 480 || y < 32 || y >= 480) && pixel)
          failures.push(asset.id + ": mask spills into material");
      }
    if (!field) failures.push(asset.id + ": empty faction field");
    masks++;
  }
  for (const age of manifest.ages) {
    const atlas = await sharp(path.join(root, age.atlas)).metadata();
    if (atlas.width !== 768 || atlas.height !== 480)
      failures.push(age.age + ": atlas dimensions");
    atlases++;
    for (const asset of manifest.assets) {
      const base = path.join(root, "icons", age.age);
      const png = await sharp(
        path.join(base, "png", asset.id + ".png"),
      ).metadata();
      if (png.width !== 512 || png.height !== 512 || !png.hasAlpha)
        failures.push(age.age + "/" + asset.id + ": PNG format");
      const svg = await fs.readFile(
        path.join(base, "svg", asset.id + ".svg"),
        "utf8",
      );
      const vector = await sharp(Buffer.from(svg)).metadata();
      if (
        vector.width !== 512 ||
        vector.height !== 512 ||
        !svg.includes('id="age-frame"') ||
        !svg.includes('id="faction-field"')
      )
        failures.push(age.age + "/" + asset.id + ": editable layers");
      pngs++;
      svgs++;
    }
  }
  if (pngs !== 259 || svgs !== 259 || masks !== 37 || atlases !== 7)
    failures.push("Incomplete asset set");
  const report = {
    status: failures.length ? "FAIL" : "PASS",
    pngs,
    editableSvgs: svgs,
    atlases,
    sharedFieldMasks: masks,
    maskSpillsIntoMaterial: failures.some((failure) =>
      failure.includes("mask spills"),
    ),
    failures,
  };
  await fs.writeFile(
    path.join(root, "Icon_File_Verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
