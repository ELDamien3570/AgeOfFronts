// Local mask painter for the Russian faction masks (all ages).
//   node scripts/maskPainter/server.cjs   ->  http://localhost:5178
// Serves the painter page, source sheets and auto-detected masks, and saves painted corrections to
// FactionMasks/<Age>/Corrections/. Saving rebuilds just that sheet's final mask (rebuildSheet.py, ~1s).
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 5178;
const REPO = path.resolve(__dirname, '..', '..');
const MASKS = path.join(REPO, 'Art', 'Cultures', 'Russians', 'FactionMasks');
const REBUILD = path.join(REPO, 'scripts', 'maskPainter', 'rebuildSheet.py');
const AGES = ['StoneAge', 'BronzeAge', 'ClassicalAge', 'EarlyMedieval'];   // whitelist: client input never becomes a path

const ageDir = age => path.join(MASKS, age);
const readManifest = age => JSON.parse(fs.readFileSync(path.join(ageDir(age), 'manifest.json'), 'utf8').replace(/^﻿/, ''));
const targetOf = sh => sh.mask.split('?')[0];
const correctionFile = (age, target) => path.join(ageDir(age), 'Corrections', target.replace('.faction-mask.png', '.correction.png'));

function findSheet(age, target) {
  if (!AGES.includes(age) || !fs.existsSync(path.join(ageDir(age), 'manifest.json'))) return null;
  for (const u of readManifest(age).units) for (const sh of u.sheets) if (targetOf(sh) === target) return { unit: u, sheet: sh };
  return null;
}

function send(res, code, body, type = 'text/plain') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendFile(res, file, type) {
  fs.readFile(file, (err, data) => (err ? send(res, 404, 'Not found') : send(res, 200, data, type)));
}
function rebuild(age, target) {
  return new Promise(resolve => {
    const p = spawn('python', [REBUILD, age, target], { cwd: REPO });
    let log = '';
    p.stdout.on('data', d => (log += d)); p.stderr.on('data', d => (log += d));
    p.on('error', e => resolve({ ok: false, log: String(e) }));
    p.on('close', code => resolve({ ok: code === 0, log }));
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const age = url.searchParams.get('a'), target = url.searchParams.get('t');

  if (req.method === 'GET' && url.pathname === '/') return sendFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');

  if (req.method === 'GET' && url.pathname === '/api/sheets') {
    const list = [];
    for (const a of AGES) {
      if (!fs.existsSync(path.join(ageDir(a), 'manifest.json'))) continue;
      for (const u of readManifest(a).units) for (const sh of u.sheets) {
        const t = targetOf(sh);
        list.push({ age: a, unit: u.name, label: u.label || u.name, file: sh.file, target: t, masked: sh.maskedPixels, hasCorrection: fs.existsSync(correctionFile(a, t)) });
      }
    }
    return send(res, 200, JSON.stringify(list), 'application/json');
  }

  if (url.pathname.startsWith('/api/') && age && target) {
    const hit = findSheet(age, target);
    if (!hit) return send(res, 404, 'Unknown sheet');
    if (req.method === 'GET' && url.pathname === '/api/source') return sendFile(res, path.normalize(path.join(ageDir(age), hit.sheet.source)), 'image/png');
    if (req.method === 'GET' && url.pathname === '/api/auto') {
      const auto = path.join(ageDir(age), 'AutoDetected', target);
      return sendFile(res, fs.existsSync(auto) ? auto : path.join(ageDir(age), target), 'image/png');   // no baseline yet -> current mask is the baseline
    }
    if (req.method === 'GET' && url.pathname === '/api/final') return sendFile(res, path.join(ageDir(age), target), 'image/png');
    if (req.method === 'GET' && url.pathname === '/api/correction') return sendFile(res, correctionFile(age, target), 'image/png');
    if (req.method === 'POST' && url.pathname === '/api/correction') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        const body = Buffer.concat(chunks), file = correctionFile(age, target);
        if (url.searchParams.get('empty') === '1') { try { fs.unlinkSync(file); } catch {} }
        else {
          if (body.length < 8 || body.readUInt32BE(0) !== 0x89504e47) return send(res, 400, 'Expected a PNG');
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, body);
        }
        const r = await rebuild(age, target);
        send(res, r.ok ? 200 : 500, JSON.stringify(r), 'application/json');
      });
      return;
    }
  }
  send(res, 404, 'Not found');
}).listen(PORT, '127.0.0.1', () => console.log('Mask painter: http://localhost:' + PORT));
