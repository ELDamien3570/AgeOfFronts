"""Scripted correction strokes for spots the global colour rule can't separate (e.g. the fallen cavalry
rider's orange-brown tunic, same hue as the horse). Adds GREEN strokes inside a region only, never
touching pixels that already have a stroke, so hand-painted corrections are preserved.
    python scripts/maskPainter/localFix.py
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter
from collections import deque
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from buildRussianBronzeAgeLeatherMasks import smooth, rgb_to_hsv, OUT, CORR, correction_path

GREEN = (0, 255, 0, 255)


def components(al, min_size=400):
    seen = np.zeros(al.shape, bool); H, W = al.shape; out = []
    for sy in range(H):
        for sx in range(W):
            if al[sy, sx] and not seen[sy, sx]:
                q = deque([(sy, sx)]); seen[sy, sx] = True; pts = []
                while q:
                    y, x = q.popleft(); pts.append((y, x))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < H and 0 <= nx < W and al[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q.append((ny, nx))
                if len(pts) >= min_size: out.append(pts)
    return sorted(out, key=len, reverse=True)


def loose_leather(rgb):
    h, s, v = rgb_to_hsv(rgb)
    h = np.where(h > 180, h - 360, h)
    skin = smooth(10, 13, h) * (1 - smooth(23, 27, h)) * smooth(0.60, 0.70, v) * (1 - smooth(0.60, 0.70, s))
    return ((1 - smooth(21, 23, h)) * smooth(0.55, 0.65, s) * smooth(0.10, 0.18, v) * (1 - smooth(0.80, 0.92, v)) * (1 - skin)) > 0.5


# target -> [(frame index, how to pick the region)]; 'comp:N' = Nth largest connected shape of that frame.
RULES = {
    'LightCavalry/Death-Thrown-v1.faction-mask.png': [(f, 'comp:1') for f in (2, 3, 4, 5)],
}
SOURCES = {'LightCavalry/Death-Thrown-v1.faction-mask.png': 'Units/BronzeAge/LightCavalry/Death-Thrown-v1.png'}
ROOT = os.path.join('Art', 'Cultures', 'Russians')

for target, rules in RULES.items():
    src = Image.open(os.path.join(ROOT, SOURCES[target])).convert('RGBA')
    a = np.asarray(src); W, H = src.size
    cpath = correction_path(target)
    corr = np.asarray(Image.open(cpath).convert('RGBA')).copy() if os.path.exists(cpath) else np.zeros((H, W, 4), np.uint8)
    loose = loose_leather(a[..., :3].astype(np.float32) / 255)
    # Keep only big solid areas (the tunic); scattered flecks on helmet, boots, bracers, spear don't survive this.
    solid = Image.fromarray((loose * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9))
    loose = loose & (np.asarray(solid) > 127)
    added = 0
    for frame, how in rules:
        cx, cy = (frame % (W // 512)) * 512, (frame // (W // 512)) * 512
        sub = a[cy:cy + 512, cx:cx + 512, 3] > 20
        region = np.zeros((H, W), bool)
        idx = int(how.split(':')[1])
        for y, x in components(sub)[idx]: region[cy + y, cx + x] = True
        new = region & loose & (corr[..., 3] == 0)
        corr[new] = GREEN; added += int(new.sum())
    os.makedirs(os.path.dirname(cpath), exist_ok=True)
    Image.fromarray(corr, 'RGBA').save(cpath)
    print(target, 'added', added, 'green pixels')
