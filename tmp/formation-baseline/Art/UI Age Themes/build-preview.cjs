const fs = require('node:fs/promises');
const path = require('node:path');
const ts = require('../../node_modules/typescript');
const root = __dirname;
const repo = path.resolve(root, '../..');

async function main() {
  // The static proposal uses a generated JS copy of the existing marker renderer.
  // Only its imported JSON and relative atlas URL are resolved for this folder.
  // No production rendering or domain source is changed.
  const source = await fs.readFile(path.join(repo, 'src/skirmish/client/BuildingMarkers.ts'), 'utf8');
  const manifest = await fs.readFile(path.join(repo, 'Art/Building Markers/building-markers.json'), 'utf8');
  const input = source.replace(/import manifest from [^;]+;/, 'const manifest = ' + manifest.trim() + ';')
    .replace('./AgeUiTheme', './shared-age-ui-theme.js')
    .replace('../../../Art/Building Markers/Building_Markers_Atlas.png', '../Building Markers/Building_Markers_Atlas.png');
  const output = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await fs.writeFile(path.join(root, 'shared-building-markers.js'), '// Generated from src/skirmish/client/BuildingMarkers.ts by build-preview.cjs.\n' + output);
  const themes = JSON.parse(await fs.readFile(path.join(root, 'themes.json'), 'utf8')).themes;
  const themeSource = await fs.readFile(path.join(repo, 'src/skirmish/client/AgeUiTheme.ts'), 'utf8');
  const themeInput = themeSource.replace(/import manifest from [^;]+;/, 'const manifest = ' + JSON.stringify({ themes }) + ';')
    .replace(/import \{ AGES, type Age \} from [^;]+;/, 'const AGES = ' + JSON.stringify(themes.map(theme => theme.age)) + ' as const; type Age = typeof AGES[number];')
    .replaceAll('../../../Art/UI Age Themes/materials/', './materials/');
  await fs.writeFile(path.join(root, 'shared-age-ui-theme.js'), '// Generated preview dependency; production source remains authoritative.\n' + ts.transpileModule(themeInput, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  const portraits = {};
  let artwork = 0;
  for (const theme of themes) {
    portraits[theme.age] = {};
    for (const type of ['barracks', 'archery', 'stables', 'city', 'port', 'mine', 'tower']) {
      const candidate = '../Runtime/Ages/building-' + theme.age.toLowerCase() + '-' + type + '.png';
      try { await fs.access(path.resolve(root, candidate)); portraits[theme.age][type] = candidate; artwork++; }
      catch { portraits[theme.age][type] = '../Building Markers/png/' + type + '.png'; }
    }
  }
  await fs.writeFile(path.join(root, 'portrait-paths.json'), JSON.stringify(portraits, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', sharedRenderer: 'BuildingMarkers.ts', themes: themes.length, existingPortraits: artwork, symbolFallbacks: themes.length * 7 - artwork }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
