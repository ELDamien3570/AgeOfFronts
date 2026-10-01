const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('C:/Users/Damien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const root = __dirname;

async function main() {
  const inputs = JSON.parse(await fs.readFile(path.join(root, 'generated/sources.json'), 'utf8')).sources;
  const records = [];
  for (const item of inputs) {
    const original = path.join(root, 'generated', item.file + '.png');
    await fs.copyFile(item.source, original);
    const meta = await sharp(original).metadata();
    if (meta.hasAlpha) throw new Error('Unexpected transparency: ' + item.file);
    const output = path.join(root, 'materials', item.file + '.webp');
    await sharp(original).resize(512, 512, { fit: 'fill' }).webp({ quality: 88 }).toFile(output);
    records.push({ age: item.age, material: item.file, sourceWidth: meta.width, sourceHeight: meta.height, width: 512, height: 512, opaque: true, webBytes: (await fs.stat(output)).size });
  }
  await fs.writeFile(path.join(root, 'Material_Validation.json'), JSON.stringify({ status: 'PASS', count: records.length, totalWebBytes: records.reduce((sum, r) => sum + r.webBytes, 0), note: 'Source images preserved. Web textures are opaque 512px copies; UI geometry is native HTML/CSS.', materials: records }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', count: records.length, totalWebBytes: records.reduce((sum, r) => sum + r.webBytes, 0) }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
