"""QA overlay: cyan = in mask, yellow = NOT in mask but still leather-hued (possible miss).
Crops each 512px frame tight to the sprite and tiles them, scaled up.
    AGE=ClassicalAge python scripts/maskPainter/misses.py Unit/sheet.faction-mask.png OUT.png [frames e.g. 1,2,3] [tile]
"""
import sys, os, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from buildRussianBronzeAgeLeatherMasks import smooth, rgb_to_hsv
B = os.path.join('Art', 'Cultures', 'Russians', 'FactionMasks', os.environ.get('AGE', 'BronzeAge'))
target, out = sys.argv[1], sys.argv[2]
want = [int(v) for v in sys.argv[3].split(',')] if len(sys.argv) > 3 and sys.argv[3] else None
tile = int(sys.argv[4]) if len(sys.argv) > 4 else 560
man = json.load(open(os.path.join(B, 'manifest.json')))
sh = next(s for u in man['units'] for s in u['sheets'] if s['mask'].split('?')[0] == target)
src = Image.open(os.path.normpath(os.path.join(B, sh['source']))).convert('RGBA')
m = np.asarray(Image.open(os.path.join(B, target)))[..., 3].astype(np.float32) / 255
a = np.asarray(src).astype(np.float32) / 255
h, s, v = rgb_to_hsv(a[..., :3]); h = np.where(h > 180, h - 360, h)
skin = smooth(10, 13, h) * (1 - smooth(23, 27, h)) * smooth(0.60, 0.70, v) * (1 - smooth(0.60, 0.70, s))
cand = (a[..., 3] > .5) & (m < .5) & (h < 16) & (s > .5) & (v > .1) & (skin < .5)
lum = (a[..., 0] * .3 + a[..., 1] * .59 + a[..., 2] * .11) * 3.2
rgb = a[..., :3].copy()
cy = np.minimum(1, np.array([0, .78, 1]) * lum[..., None]); ye = np.array([1, .95, 0])
rgb = np.where(m[..., None] > .5, cy, rgb); rgb = np.where(cand[..., None], ye, rgb)
img = Image.fromarray((rgb * 255).astype(np.uint8)); al = Image.fromarray((a[..., 3] * 255).astype(np.uint8))
bg = Image.new('RGBA', src.size, (60, 60, 70, 255)); bg.alpha_composite(Image.merge('RGBA', (*img.split(), al))); bg = bg.convert('RGB')
cols = src.width // 512; frames = want if want is not None else list(range(cols * (src.height // 512)))
cols_out = min(3, len(frames)); rows_out = (len(frames) + cols_out - 1) // cols_out
sheet = Image.new('RGB', (cols_out * tile, rows_out * tile), (60, 60, 70))
for i, f in enumerate(frames):
    c, r = f % cols, f // cols
    fr = bg.crop((c * 512, r * 512, c * 512 + 512, r * 512 + 512))
    ys, xs = np.where(a[r * 512:(r + 1) * 512, c * 512:(c + 1) * 512, 3] > .08)
    if len(xs): fr = fr.crop((max(0, xs.min() - 6), max(0, ys.min() - 6), min(512, xs.max() + 6), min(512, ys.max() + 6)))
    k = min(tile / fr.width, tile / fr.height); fr = fr.resize((int(fr.width * k), int(fr.height * k)), Image.LANCZOS)
    sheet.paste(fr, ((i % cols_out) * tile + (tile - fr.width) // 2, (i // cols_out) * tile + (tile - fr.height) // 2))
sheet.save(out)
