"""Seedless dark-cloth rule: shadowed saturated red (hue<HUE, sat>SAT, val 0.1-VMAX) inside a rider box, no neighbour needed,
cleaned by an opening so thin outlines/straps drop out. Writes GREEN correction strokes.
  AGE=EarlyMedieval HUE=19.5 SAT=.7 VMAX=.5 python darkCloth.py Unit SheetPrefix x0,y0,x1,y1 [--apply] [--preview OUT frames]
"""
import os, sys, json
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from buildRussianBronzeAgeLeatherMasks import smooth, rgb_to_hsv
OUT = os.path.join('Art', 'Cultures', 'Russians', 'FactionMasks', os.environ.get('AGE', 'EarlyMedieval'))
HUE = float(os.environ.get('HUE', 19.5)); SAT = float(os.environ.get('SAT', .7)); VMAX = float(os.environ.get('VMAX', .5)); OPEN = int(os.environ.get('OPEN', 5)); VMIN = float(os.environ.get('VMIN', .1)); NEAR = int(os.environ.get('NEAR', 0))

def rule(src, box, frames, mask=None):
    a = src.astype(np.float32) / 255
    h, s, v = rgb_to_hsv(a[..., :3]); h = np.where(h > 180, h - 360, h)
    ok = (a[..., 3] > .5) & (h < HUE) & (s > SAT) & (v > VMIN) & (v < VMAX)
    ok = np.asarray(Image.fromarray((ok * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(OPEN)).filter(ImageFilter.MaxFilter(OPEN))) > 127
    keep = np.zeros_like(ok); cols = ok.shape[1] // 512
    for f in frames:
        x, y = (f % cols) * 512, (f // cols) * 512
        keep[y + box[1]:y + box[3], x + box[0]:x + box[2]] = True
    if NEAR and mask is not None:
        near = np.asarray(Image.fromarray(mask).filter(ImageFilter.MaxFilter(NEAR))) > 127
        ok = ok & near
    return ok & keep

if __name__ == '__main__':
    unit, prefix = sys.argv[1], sys.argv[2]; box = [int(x) for x in sys.argv[3].split(',')]
    frames = [int(x) for x in os.environ.get('FRAMES', '0,1,2,3,4,5').split(',')]
    man = json.load(open(os.path.join(OUT, 'manifest.json')))
    for u in man['units']:
        if u['name'] != unit: continue
        for sh in u['sheets']:
            if not sh['file'].startswith(prefix): continue
            t = sh['mask'].split('?')[0]
            src = np.asarray(Image.open(os.path.normpath(os.path.join(OUT, sh['source']))).convert('RGBA'))
            mask = np.asarray(Image.open(os.path.join(OUT, t)))[..., 3]
            add = rule(src, box, frames, mask) & (mask < 128)
            cp = os.path.join(OUT, 'Corrections', t.replace('.faction-mask.png', '.correction.png'))
            corr = np.asarray(Image.open(cp).convert('RGBA')).copy() if os.path.exists(cp) else np.zeros(src.shape, np.uint8)
            add &= corr[..., 3] == 0
            print(unit, sh['file'], int(add.sum()))
            if '--apply' in sys.argv:
                corr[add] = (0, 255, 0, 255); os.makedirs(os.path.dirname(cp), exist_ok=True); Image.fromarray(corr, 'RGBA').save(cp)
            if '--preview' in sys.argv:
                v = src.astype(np.float32) / 255; v[..., :3] = np.where((mask > 127)[..., None], [0, .78, 1], v[..., :3]); v[add, :3] = (.1, 1, .1)
                cols = src.shape[1] // 512; tiles = []
                for f in frames:
                    x, y = (f % cols) * 512, (f // cols) * 512
                    bg = np.full((512, 512, 3), .22, np.float32); al = v[y:y + 512, x:x + 512, 3:4]
                    bg = bg * (1 - al) + v[y:y + 512, x:x + 512, :3] * al
                    tiles.append(Image.fromarray((bg * 255).astype(np.uint8)).crop((box[0] - 20, box[1] - 30, box[2] + 20, box[3] + 20)).resize(((box[2] - box[0] + 40) * 2, (box[3] - box[1] + 50) * 2), Image.NEAREST))
                o = Image.new('RGB', (sum(t.width for t in tiles), tiles[0].height)); x = 0
                for t in tiles: o.paste(t, (x, 0)); x += t.width
                o.save(sys.argv[sys.argv.index('--preview') + 1])
