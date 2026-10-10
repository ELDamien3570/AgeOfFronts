"""Preview of classicalGrow additions: cyan = existing mask, orange = would be added.
    python scripts/maskPainter/growPreview.py Unit/sheet.faction-mask.png OUT.png FRAMES [tile]
"""
import sys, os, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import classicalGrow as g
OUT = g.OUT
target, out = sys.argv[1], sys.argv[2]; frames = [int(x) for x in sys.argv[3].split(',')]; tile = int(sys.argv[4]) if len(sys.argv) > 4 else 500
man = json.load(open(os.path.join(OUT, 'manifest.json')))
sh = next(s for u in man['units'] for s in u['sheets'] if s['mask'].split('?')[0] == target)
src = np.asarray(Image.open(os.path.normpath(os.path.join(OUT, sh['source']))).convert('RGBA'))
m = np.asarray(Image.open(os.path.join(OUT, target)))[..., 3].astype(np.float32) / 255
auto = np.asarray(Image.open(os.path.join(OUT, 'AutoDetected', target)))[..., 3].astype(np.float32) / 255
reach = int(os.environ.get('REACH', 21)); box = tuple(int(v) for v in os.environ['BOX'].split(',')) if os.environ.get('BOX') else None
add = g.grow(src, auto, reach, box, float(os.environ.get('HUE', 16)), float(os.environ.get('VMAX', .8)), int(os.environ.get('PASSES', 1))) & (m < .5)
a = src.astype(np.float32) / 255; lum = (a[..., 0] * .3 + a[..., 1] * .59 + a[..., 2] * .11) * 3.2
rgb = a[..., :3].copy()
rgb = np.where((m > .5)[..., None], np.minimum(1, np.array([0, .78, 1]) * lum[..., None]), rgb)
rgb = np.where(add[..., None], np.array([0.1, 1, 0.1]) if os.environ.get('SOLID') else np.minimum(1, np.array([1, .5, 0]) * lum[..., None] + .15), rgb)
img = Image.fromarray((rgb * 255).astype(np.uint8)); al = Image.fromarray(src[..., 3])
bg = Image.new('RGBA', img.size, (60, 60, 70, 255)); bg.alpha_composite(Image.merge('RGBA', (*img.split(), al))); bg = bg.convert('RGB')
cols = src.shape[1] // 512; co = min(3, len(frames)); ro = (len(frames) + co - 1) // co
sheet = Image.new('RGB', (co * tile, ro * tile), (60, 60, 70))
for i, f in enumerate(frames):
    c, r = f % cols, f // cols
    fr = bg.crop((c * 512, r * 512, c * 512 + 512, r * 512 + 512))
    ys, xs = np.where(src[r * 512:(r + 1) * 512, c * 512:(c + 1) * 512, 3] > 20)
    if len(xs): fr = fr.crop((max(0, xs.min() - 6), max(0, ys.min() - 6), min(512, xs.max() + 6), min(512, ys.max() + 6)))
    k = min(tile / fr.width, tile / fr.height); fr = fr.resize((int(fr.width * k), int(fr.height * k)), Image.LANCZOS)
    sheet.paste(fr, ((i % co) * tile + (tile - fr.width) // 2, (i // co) * tile + (tile - fr.height) // 2))
sheet.save(out)
