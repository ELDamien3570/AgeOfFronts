"""Tinted preview of a sheet's final mask (leather -> bright cyan) for visual QA.
    python scripts/maskPainter/preview.py Unit/sheet.faction-mask.png OUT.png [x0 y0 x1 y1] [scale]
"""
import sys, os, json
import numpy as np
from PIL import Image
B = os.path.join('Art', 'Cultures', 'Russians', 'FactionMasks', os.environ.get('AGE', 'BronzeAge'))
target, out = sys.argv[1], sys.argv[2]
box = tuple(int(v) for v in sys.argv[3:7]) if len(sys.argv) >= 7 else None
scale = float(sys.argv[7]) if len(sys.argv) >= 8 else 1
man = json.load(open(os.path.join(B, 'manifest.json')))
sh = next(s for u in man['units'] for s in u['sheets'] if s['mask'].split('?')[0] == target)
src = Image.open(os.path.normpath(os.path.join(B, sh['source']))).convert('RGBA')
m = np.asarray(Image.open(os.path.join(B, target)))[..., 3].astype(np.float32) / 255
a = np.asarray(src).astype(np.float32)
lum = (a[..., 0] * .3 + a[..., 1] * .59 + a[..., 2] * .11) / 255 * 3.2
tint = np.array([0, 200, 255], np.float32)
rgb = a[..., :3] * (1 - m[..., None]) + np.minimum(255, tint * lum[..., None]) * m[..., None]
img = Image.fromarray(rgb.astype(np.uint8)); alpha = Image.fromarray(a[..., 3].astype(np.uint8))
bg = Image.new('RGBA', src.size, (60, 60, 70, 255)); bg.alpha_composite(Image.merge('RGBA', (*img.split(), alpha)))
bg = bg.convert('RGB')
if box: bg = bg.crop(box)
if scale != 1: bg = bg.resize((int(bg.width * scale), int(bg.height * scale)), Image.LANCZOS)
bg.save(out)
