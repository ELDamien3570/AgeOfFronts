"""Fast single-sheet rebuild for any age: final mask = AutoDetected mask with painted corrections applied.
green stroke -> pixel becomes leather (source alpha), red stroke -> not leather.  If an age has no AutoDetected copy yet
(Stone Age), the current mask is saved there first as the baseline.  Also refreshes manifest maskedPixels + cache tag.
    python scripts/maskPainter/rebuildSheet.py AGE Unit/sheet.faction-mask.png
"""
import json, os, shutil, sys, time
import numpy as np
from PIL import Image

age, target = sys.argv[1], sys.argv[2]
OUT = os.path.join('Art', 'Cultures', 'Russians', 'FactionMasks', age)
mpath = os.path.join(OUT, 'manifest.json')
man = json.load(open(mpath, encoding='utf-8-sig'))
sh = next(s for u in man['units'] for s in u['sheets'] if s['mask'].split('?')[0] == target)

final = os.path.join(OUT, target)
auto = os.path.join(OUT, 'AutoDetected', target)
if not os.path.exists(auto):
    os.makedirs(os.path.dirname(auto), exist_ok=True)
    shutil.copyfile(final, auto)

src_alpha = np.asarray(Image.open(os.path.normpath(os.path.join(OUT, sh['source']))).convert('RGBA'))[..., 3]
alpha = np.asarray(Image.open(auto).convert('RGBA'))[..., 3].copy()
cpath = os.path.join(OUT, 'Corrections', target.replace('.faction-mask.png', '.correction.png'))
if os.path.exists(cpath):
    c = np.asarray(Image.open(cpath).convert('RGBA'))
    if c.shape[:2] != alpha.shape:
        raise SystemExit('Correction size does not match sheet: ' + cpath)
    on = c[..., 3] > 127
    add = on & (c[..., 1] > 127) & (c[..., 0] < 128)
    erase = on & (c[..., 0] > 127) & (c[..., 1] < 128)
    alpha = np.where(add, src_alpha, alpha)
    alpha = np.where(erase, 0, alpha)
out = np.dstack([np.full(alpha.shape, 255, np.uint8)] * 3 + [alpha.astype(np.uint8)])
Image.fromarray(out, 'RGBA').save(final)

sh['maskedPixels'] = int((alpha >= 128).sum())
base = sh['mask'].split('?')[0]
sh['mask'] = base + '?v=' + str(int(time.time()))      # new URL so review pages never show a stale PNG
with open(mpath, 'w', encoding='utf-8') as f:
    json.dump(man, f, indent=2); f.write('\n')
print('rebuilt', age, target, sh['maskedPixels'])
