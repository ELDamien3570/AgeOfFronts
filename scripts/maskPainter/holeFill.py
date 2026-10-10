"""Close small holes/jagged gaps inside an existing mask: closing(mask) restricted to leather-hued source pixels.
Writes GREEN correction strokes (never over existing strokes).  AGE=EarlyMedieval python holeFill.py [--dry-run] [--preview Unit/sheet FRAMES OUT] Unit ...
"""
import os, sys, json
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from buildRussianBronzeAgeLeatherMasks import smooth, rgb_to_hsv
OUT = os.path.join('Art', 'Cultures', 'Russians', 'FactionMasks', os.environ.get('AGE', 'EarlyMedieval'))
K = int(os.environ.get('K', 9)); HUE = float(os.environ.get('HUE', 22)); SAT = float(os.environ.get('SAT', .45))

BOX = tuple(int(x) for x in os.environ['BOX'].split(',')) if os.environ.get('BOX') else None

def fill(src, mask):
    a = src.astype(np.float32) / 255
    h, s, v = rgb_to_hsv(a[..., :3]); h = np.where(h > 180, h - 360, h)
    skin = smooth(10, 13, h) * (1 - smooth(23, 27, h)) * smooth(0.60, 0.70, v) * (1 - smooth(0.60, 0.70, s))
    ok = (a[..., 3] > .5) & (h < HUE) & (s > SAT) & (v > .08) & (skin < .5)
    m = Image.fromarray((mask * 255).astype(np.uint8))
    closed = np.asarray(m.filter(ImageFilter.MaxFilter(K)).filter(ImageFilter.MinFilter(K))) > 127
    out = closed & ok & ~(mask > .5)
    if BOX:
        keep = np.zeros_like(out)
        for fy in range(0, out.shape[0], 512):
            for fx in range(0, out.shape[1], 512):
                keep[fy + BOX[1]:fy + BOX[3], fx + BOX[0]:fx + BOX[2]] = True
        out &= keep
    return out

def main():
    dry = '--dry-run' in sys.argv
    units = [x for x in sys.argv[1:] if not x.startswith('--')]
    man = json.load(open(os.path.join(OUT, 'manifest.json')))
    for u in man['units']:
        if u['name'] not in units: continue
        for sh in u['sheets']:
            if 'death' in sh['file'].lower() and os.environ.get('DEATH') != '1': continue
            t = sh['mask'].split('?')[0]
            src = np.asarray(Image.open(os.path.normpath(os.path.join(OUT, sh['source']))).convert('RGBA'))
            mask = np.asarray(Image.open(os.path.join(OUT, t)))[..., 3].astype(np.float32) / 255
            add = fill(src, mask)
            cp = os.path.join(OUT, 'Corrections', t.replace('.faction-mask.png', '.correction.png'))
            corr = np.asarray(Image.open(cp).convert('RGBA')).copy() if os.path.exists(cp) else np.zeros(src.shape, np.uint8)
            add &= corr[..., 3] == 0
            print(u['name'], sh['file'], int(add.sum()))
            if os.environ.get('PREVIEW') == sh['file'][:4]:
                v = src.copy(); v[..., :3] = np.where((mask > .5)[..., None], [0, 200, 255], v[..., :3]); v[add, :3] = (20, 255, 20)
                Image.fromarray(v).save(os.environ['PREVOUT'])
            if not dry and add.any():
                corr[add] = (0, 255, 0, 255); os.makedirs(os.path.dirname(cp), exist_ok=True); Image.fromarray(corr, 'RGBA').save(cp)
main()
